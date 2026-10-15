//go:build windows

package security

import (
	"fmt"
	"golang.org/x/sys/windows"
	"unsafe"
)

type dpapiStore struct{}

func NewSecretStore(_ string) (SecretStore, error) { return dpapiStore{}, nil }
func blob(b []byte) windows.DataBlob {
	if len(b) == 0 {
		return windows.DataBlob{}
	}
	return windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
}
func dpapi(owner, purpose string, b []byte, decrypt bool) ([]byte, error) {
	if owner == "" || purpose == "" {
		return nil, fmt.Errorf("secret owner and purpose required")
	}
	if len(b) == 0 {
		return []byte{}, nil
	}
	in := blob(b)
	entropy := blob([]byte("AI_Server_Studio\x00" + owner + "\x00" + purpose))
	var out windows.DataBlob
	var err error
	if decrypt {
		err = windows.CryptUnprotectData(&in, nil, &entropy, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out)
	} else {
		err = windows.CryptProtectData(&in, nil, &entropy, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out)
	}
	if err != nil {
		return nil, fmt.Errorf("credential protection failed: %w", err)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, int(out.Size))...), nil
}
func (dpapiStore) Protect(o, p string, b []byte) ([]byte, error)   { return dpapi(o, p, b, false) }
func (dpapiStore) Unprotect(o, p string, b []byte) ([]byte, error) { return dpapi(o, p, b, true) }
