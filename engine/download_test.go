package engine

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"database/sql"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ai-server-studio-backend/persistence"
)

func TestDownloadUsesModelRootAndVerifiesDigest(t *testing.T) {
	payload := []byte("hermetic gguf payload")
	digest := sha256.Sum256(payload)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	root := t.TempDir()
	dm, db := testDownloadManager(t, root, server, 1<<20)
	taskID, err := dm.StartDownload("https://example.com/model.gguf", "model.gguf", hex.EncodeToString(digest[:]))
	if err != nil {
		t.Fatal(err)
	}
	if !looksLikeUUID(taskID) {
		t.Fatalf("task id is not a UUID: %q", taskID)
	}
	state := waitDownload(t, dm, taskID, DownloadCompleted)
	canonicalRoot, _ := filepath.EvalSymlinks(root)
	if state.DestPath != filepath.Join(canonicalRoot, "model.gguf") || !state.Done {
		t.Fatalf("unexpected completed state: %+v", state)
	}
	got, err := os.ReadFile(filepath.Join(root, "model.gguf"))
	if err != nil || string(got) != string(payload) {
		t.Fatalf("artifact: %q %v", got, err)
	}
	_ = db.Close()
}

func TestDownloadRejectsUnsafeInputsAndPrivateSources(t *testing.T) {
	db, err := persistence.Open(filepath.Join(t.TempDir(), "studio.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	dm := NewDownloadManagerWithConfig(DownloadConfig{ModelRoot: t.TempDir(), ApprovedHosts: []string{"example.com"}})
	if err = dm.Configure(db, dm.config.ModelRoot); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, rawURL, filename, digest string
	}{
		{"http", "http://example.com/model.gguf", "model.gguf", strings.Repeat("a", 64)},
		{"private-ip", "https://127.0.0.1/model.gguf", "model.gguf", strings.Repeat("a", 64)},
		{"path", "https://example.com/model.gguf", "../model.gguf", strings.Repeat("a", 64)},
		{"extension", "https://example.com/model.gguf", "model.bin", strings.Repeat("a", 64)},
		{"digest", "https://example.com/model.gguf", "model.gguf", "not-a-digest"},
	} {
		t.Run(test.name, func(t *testing.T) {
			// Input validation runs before persistence and does not require a DB.
			_, err := dm.StartDownload(test.rawURL, test.filename, test.digest)
			if err == nil || !errors.Is(err, ErrDownloadValidation) {
				t.Fatalf("expected validation error, got %v", err)
			}
		})
	}
}

func TestDownloadRefusesOverwriteAndDuplicateArtifacts(t *testing.T) {
	payload := []byte("already trusted")
	digest := sha256.Sum256(payload)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("must not be fetched"))
	}))
	defer server.Close()
	root := t.TempDir()
	dm, db := testDownloadManager(t, root, server, 1<<20)
	path := filepath.Join(root, "model.gguf")
	if err := os.WriteFile(path, payload, 0600); err != nil {
		t.Fatal(err)
	}
	id, err := dm.StartDownload("https://example.com/model.gguf", "model.gguf", hex.EncodeToString(digest[:]))
	if err != nil {
		t.Fatal(err)
	}
	waitDownload(t, dm, id, DownloadCompleted)
	id2, err := dm.StartDownload("https://example.com/model.gguf", "model.gguf", hex.EncodeToString(digest[:]))
	if err != nil || id2 != id {
		t.Fatalf("expected stable duplicate task ID, got %q %v", id2, err)
	}

	badPath := filepath.Join(root, "bad.gguf")
	if err = os.WriteFile(badPath, []byte("bad"), 0600); err != nil {
		t.Fatal(err)
	}
	badID, err := dm.StartDownload("https://example.com/bad.gguf", "bad.gguf", hex.EncodeToString(digest[:]))
	if err != nil {
		t.Fatal(err)
	}
	waitDownload(t, dm, badID, DownloadFailed)
	got, _ := os.ReadFile(badPath)
	if string(got) != "bad" {
		t.Fatal("invalid pre-existing artifact was overwritten")
	}
	_ = db.Close()
}

func TestDownloadCancellationPreventsFinalization(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "100")
		w.WriteHeader(http.StatusOK)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		close(started)
		<-r.Context().Done()
	}))
	defer server.Close()
	root := t.TempDir()
	dm, db := testDownloadManager(t, root, server, 1<<20)
	id, err := dm.StartDownload("https://example.com/model.gguf", "model.gguf", strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("download did not reach server")
	}
	if err = dm.Cancel(id); err != nil {
		t.Fatal(err)
	}
	waitDownload(t, dm, id, DownloadCancelled)
	if _, err = os.Stat(filepath.Join(root, "model.gguf")); !os.IsNotExist(err) {
		t.Fatalf("cancelled download finalized artifact: %v", err)
	}
	_ = db.Close()
}

func TestDownloadChecksumMismatchAndOversizeNeverFinalize(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/large.gguf" {
			w.Header().Set("Content-Length", "8")
			_, _ = w.Write([]byte("12345678"))
			return
		}
		_, _ = w.Write([]byte("wrong"))
	}))
	defer server.Close()
	root := t.TempDir()
	dm, db := testDownloadManager(t, root, server, 6)
	wrongID, err := dm.StartDownload("https://example.com/wrong.gguf", "wrong.gguf", strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	wrong := waitDownload(t, dm, wrongID, DownloadFailed)
	if !strings.Contains(wrong.Error, "SHA-256 mismatch") {
		t.Fatalf("checksum failure was not recorded: %+v", wrong)
	}
	if _, err = os.Stat(filepath.Join(root, "wrong.gguf")); !os.IsNotExist(err) {
		t.Fatalf("checksum failure finalized an artifact: %v", err)
	}

	largeID, err := dm.StartDownload("https://example.com/large.gguf", "large.gguf", strings.Repeat("b", 64))
	if err != nil {
		t.Fatal(err)
	}
	large := waitDownload(t, dm, largeID, DownloadFailed)
	if !strings.Contains(large.Error, "maximum size") {
		t.Fatalf("oversize failure was not recorded: %+v", large)
	}
	if _, err = os.Stat(filepath.Join(root, "large.gguf")); !os.IsNotExist(err) {
		t.Fatalf("oversize transfer finalized an artifact: %v", err)
	}
	_ = db.Close()
}

func TestDownloadRedirectToProhibitedAddressIsRejected(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://127.0.0.1/model.gguf", http.StatusFound)
	}))
	defer server.Close()
	root := t.TempDir()
	dm, db := testDownloadManager(t, root, server, 1<<20)
	id, err := dm.StartDownload("https://example.com/model.gguf", "redirect.gguf", strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	state := waitDownload(t, dm, id, DownloadFailed)
	if !strings.Contains(state.Error, "approved") && !strings.Contains(state.Error, "private") {
		t.Fatalf("redirect validation error was not recorded: %+v", state)
	}
	if _, err = os.Stat(filepath.Join(root, "redirect.gguf")); !os.IsNotExist(err) {
		t.Fatalf("prohibited redirect finalized an artifact: %v", err)
	}
	_ = db.Close()
}

func TestDownloadProgressIsACopy(t *testing.T) {
	payload := []byte("copy check")
	digest := sha256.Sum256(payload)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	dm, db := testDownloadManager(t, t.TempDir(), server, 1<<20)
	id, err := dm.StartDownload("https://example.com/model.gguf", "copy.gguf", hex.EncodeToString(digest[:]))
	if err != nil {
		t.Fatal(err)
	}
	state := waitDownload(t, dm, id, DownloadCompleted)
	state.Status = DownloadFailed
	state.BytesReceived = -1
	again, ok := dm.GetProgress(id)
	if !ok || again.Status != DownloadCompleted || again.BytesReceived < 0 {
		t.Fatalf("download state was returned by mutable reference: %+v", again)
	}
	_ = db.Close()
}

func TestDownloadRestartRecoveryNeverCompletesIncompleteWork(t *testing.T) {
	db, err := persistence.Open(filepath.Join(t.TempDir(), "studio.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	root := t.TempDir()
	first := NewDownloadManagerWithConfig(DownloadConfig{ModelRoot: root, ApprovedHosts: []string{"example.com"}})
	if err = first.Configure(db, root); err != nil {
		t.Fatal(err)
	}
	created := nowMillis()
	if _, err = db.Exec(`INSERT INTO download_tasks(id,url,filename,dest_path,expected_sha256,status,created_at,updated_at) VALUES(?,?,?,?,?,'downloading',?,?)`, "11111111-1111-4111-8111-111111111111", "https://example.com/model.gguf", "model.gguf", filepath.Join(root, "model.gguf"), strings.Repeat("a", 64), created, created); err != nil {
		t.Fatal(err)
	}
	second := NewDownloadManagerWithConfig(DownloadConfig{ModelRoot: root, ApprovedHosts: []string{"example.com"}})
	if err = second.Configure(db, root); err != nil {
		t.Fatal(err)
	}
	state, ok := second.GetProgress("11111111-1111-4111-8111-111111111111")
	if !ok || state.Status != DownloadInterrupted || state.Done {
		t.Fatalf("incomplete task was not recovered as interrupted: %+v", state)
	}
}

func testDownloadManager(t *testing.T, root string, server *httptest.Server, maxBytes int64) (*DownloadManager, *sql.DB) {
	t.Helper()
	db, err := persistence.Open(filepath.Join(t.TempDir(), "studio.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	transport := server.Client().Transport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} // test server only
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		dialer := net.Dialer{}
		return dialer.DialContext(ctx, network, server.Listener.Addr().String())
	}
	dm := NewDownloadManagerWithConfig(DownloadConfig{
		ModelRoot: root, ApprovedHosts: []string{"example.com"}, MaxBytes: maxBytes,
		HTTPClient: &http.Client{Transport: transport, Timeout: 5 * time.Second},
	})
	if err = dm.Configure(db, root); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	return dm, db
}

func waitDownload(t *testing.T, dm *DownloadManager, id, status string) *DownloadState {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		state, ok := dm.GetProgress(id)
		if ok && state.Status == status {
			if status == DownloadCompleted || status == DownloadFailed || status == DownloadCancelled {
				for time.Now().Before(deadline) {
					dm.mu.RLock()
					active := len(dm.active)
					dm.mu.RUnlock()
					if active == 0 {
						break
					}
					time.Sleep(2 * time.Millisecond)
				}
			}
			return state
		}
		time.Sleep(10 * time.Millisecond)
	}
	state, _ := dm.GetProgress(id)
	t.Fatalf("download did not reach %s: %+v", status, state)
	return nil
}

func looksLikeUUID(value string) bool {
	return len(value) == 36 && value[8] == '-' && value[13] == '-' && value[18] == '-' && value[23] == '-'
}
