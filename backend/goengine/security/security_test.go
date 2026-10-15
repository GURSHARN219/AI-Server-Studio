package security

import (
	"encoding/base64"
	"golang.org/x/crypto/bcrypt"
	"strings"
	"testing"
)

func TestPasswordVerificationAndLegacyUpgrade(t *testing.T) {
	hash, e := HashPassword("correct-password")
	if e != nil {
		t.Fatal(e)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Fatal("expected Argon2id")
	}
	for _, tc := range []struct {
		encoded, password string
		valid, upgrade    bool
	}{{hash, "correct-password", true, false}, {hash, "wrong", false, false}, {"$argon2id$v=19$m=999999999,t=3,p=2$x$x", "correct-password", false, false}, {TokenHash("correct-password"), "correct-password", true, true}, {TokenHash("correct-password"), "wrong", false, true}} {
		v, u := VerifyPassword(tc.encoded, tc.password)
		if v != tc.valid || u != tc.upgrade {
			t.Fatalf("verify mismatch: %v %v", v, u)
		}
	}
	old, e := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if e != nil {
		t.Fatal(e)
	}
	valid, upgrade := VerifyPassword(string(old), "correct-password")
	if !valid || !upgrade {
		t.Fatal("bcrypt upgrade missing")
	}
}
func TestCredentialProtectionIsOwnerAndPurposeBound(t *testing.T) {
	t.Setenv("AI_SERVER_SECRET_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	store, e := NewSecretStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	plain := []byte("synthetic-test-credential")
	cipher, e := store.Protect("owner-a", "provider:one", plain)
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(cipher), string(plain)) {
		t.Fatal("plaintext stored")
	}
	got, e := store.Unprotect("owner-a", "provider:one", cipher)
	if e != nil || string(got) != string(plain) {
		t.Fatal("roundtrip failed", e)
	}
	for _, pair := range [][2]string{{"owner-b", "provider:one"}, {"owner-a", "provider:two"}} {
		if _, e = store.Unprotect(pair[0], pair[1], cipher); e == nil {
			t.Fatal("substituted identity decrypted secret")
		}
	}
	cipher[len(cipher)-1] ^= 1
	if _, e = store.Unprotect("owner-a", "provider:one", cipher); e == nil {
		t.Fatal("tampered secret accepted")
	}
}
