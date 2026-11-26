package updater

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestCheckWithoutTrustedSourceIsExplicitlyUnavailable(t *testing.T) {
	status, err := New(Config{CurrentVersion: "0.0.0"}).Check(context.Background())
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("error = %v, want ErrNotConfigured", err)
	}
	if status.State != "unavailable" || status.Configured {
		t.Fatalf("status = %+v, want unavailable and unconfigured", status)
	}
}

func TestValidateManifestRejectsSignedArtifactWithoutVerifier(t *testing.T) {
	err := validateManifest(Manifest{Version: "1.0.0", Artifact: "https://github.com/org/release.exe", SHA256: strings.Repeat("a", 64), Signature: "signature"})
	if !errors.Is(err, ErrUpdateValidation) {
		t.Fatalf("error = %v, want ErrUpdateValidation", err)
	}
}

func TestValidateURLRejectsUnapprovedOrInsecureSources(t *testing.T) {
	for _, raw := range []string{"http://github.com/update.json", "https://example.com/update.json", "https://127.0.0.1/update.json"} {
		if _, err := validateURL(raw, []string{"github.com"}); !errors.Is(err, ErrUpdateValidation) {
			t.Fatalf("URL %q error = %v, want ErrUpdateValidation", raw, err)
		}
	}
}
