package security

// SecretStore binds ciphertext to an account and credential purpose.
type SecretStore interface {
	Protect(owner, purpose string, plaintext []byte) ([]byte, error)
	Unprotect(owner, purpose string, ciphertext []byte) ([]byte, error)
}
