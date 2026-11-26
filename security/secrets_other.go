//go:build !windows

package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type aesStore struct{ aead cipher.AEAD }

func NewSecretStore(dbDir string) (SecretStore, error) {
	keyText := strings.TrimSpace(os.Getenv("AI_SERVER_SECRET_KEY"))
	if path := strings.TrimSpace(os.Getenv("AI_SERVER_SECRET_KEY_FILE")); path != "" {
		if !filepath.IsAbs(path) {
			return nil, fmt.Errorf("secret key file must be absolute")
		}
		resolved, e := filepath.EvalSymlinks(path)
		if e != nil {
			return nil, e
		}
		dir, e := filepath.EvalSymlinks(dbDir)
		if e != nil {
			return nil, e
		}
		rel, e := filepath.Rel(dir, resolved)
		if e != nil || rel == "." || (!strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != "..") {
			return nil, fmt.Errorf("secret key file must be outside database directory")
		}
		st, e := os.Stat(resolved)
		if e != nil {
			return nil, e
		}
		if st.Mode().Perm()&0077 != 0 {
			return nil, fmt.Errorf("secret key file permissions must be owner-only")
		}
		b, e := os.ReadFile(resolved)
		if e != nil {
			return nil, e
		}
		keyText = strings.TrimSpace(string(b))
	}
	key, e := base64.StdEncoding.DecodeString(keyText)
	if e != nil || len(key) != 32 {
		return nil, fmt.Errorf("provision a base64 32-byte AI_SERVER_SECRET_KEY or external AI_SERVER_SECRET_KEY_FILE")
	}
	block, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	a, e := cipher.NewGCM(block)
	if e != nil {
		return nil, e
	}
	return aesStore{a}, nil
}
func (s aesStore) Protect(o, p string, b []byte) ([]byte, error) {
	if o == "" || p == "" {
		return nil, fmt.Errorf("owner and purpose required")
	}
	n := make([]byte, s.aead.NonceSize())
	if _, e := rand.Read(n); e != nil {
		return nil, e
	}
	return s.aead.Seal(n, n, b, []byte(o+"\x00"+p)), nil
}
func (s aesStore) Unprotect(o, p string, b []byte) ([]byte, error) {
	n := s.aead.NonceSize()
	if len(b) < n {
		return nil, fmt.Errorf("invalid encrypted credential")
	}
	return s.aead.Open(nil, b[:n], b[n:], []byte(o+"\x00"+p))
}
