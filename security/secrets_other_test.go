//go:build !windows

package security

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestExternalSecretKeyFailsClosed(t *testing.T) {
	dbDir := t.TempDir()
	t.Setenv("AI_SERVER_SECRET_KEY", "")
	t.Setenv("AI_SERVER_SECRET_KEY_FILE", "")
	if _, e := NewSecretStore(dbDir); e == nil {
		t.Fatal("missing external key accepted")
	}
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	inside := filepath.Join(dbDir, "key")
	if e := os.WriteFile(inside, []byte(key), 0600); e != nil {
		t.Fatal(e)
	}
	t.Setenv("AI_SERVER_SECRET_KEY_FILE", inside)
	if _, e := NewSecretStore(dbDir); e == nil {
		t.Fatal("database sibling plaintext key accepted")
	}
	outside := filepath.Join(t.TempDir(), "key")
	if e := os.WriteFile(outside, []byte(key), 0600); e != nil {
		t.Fatal(e)
	}
	t.Setenv("AI_SERVER_SECRET_KEY_FILE", outside)
	if _, e := NewSecretStore(dbDir); e != nil {
		t.Fatal(e)
	}
	if e := os.Chmod(outside, 0644); e != nil {
		t.Fatal(e)
	}
	if _, e := NewSecretStore(dbDir); e == nil {
		t.Fatal("world-readable key accepted")
	}
}
