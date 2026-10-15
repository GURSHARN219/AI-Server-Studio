package security

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
	"strings"
)

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=2$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

// VerifyPassword accepts old hashes only to upgrade them after verified login.
func VerifyPassword(encoded, password string) (valid, upgrade bool) {
	if strings.HasPrefix(encoded, "$argon2id$") {
		parts := strings.Split(encoded, "$")
		if len(parts) != 6 || parts[2] != "v=19" || parts[3] != "m=65536,t=3,p=2" {
			return false, false
		}
		salt, e := base64.RawStdEncoding.DecodeString(parts[4])
		if e != nil || len(salt) != 16 {
			return false, false
		}
		want, e := base64.RawStdEncoding.DecodeString(parts[5])
		if e != nil || len(want) != 32 {
			return false, false
		}
		got := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
		return subtle.ConstantTimeCompare(got, want) == 1, false
	}
	if strings.HasPrefix(encoded, "$2") {
		return bcrypt.CompareHashAndPassword([]byte(encoded), []byte(password)) == nil, true
	}
	if len(encoded) == 64 {
		sum := sha256.Sum256([]byte(password))
		return subtle.ConstantTimeCompare([]byte(encoded), []byte(hex.EncodeToString(sum[:]))) == 1, true
	}
	return false, false
}

func TokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
func Token() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
