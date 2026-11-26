package engine

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"ai-server-studio-backend/persistence"
	"ai-server-studio-backend/portable"
)

const (
	DownloadQueued      = "queued"
	DownloadDownloading = "downloading"
	DownloadVerifying   = "verifying"
	DownloadCompleted   = "completed"
	DownloadFailed      = "failed"
	DownloadCancelled   = "cancelled"
	DownloadInterrupted = "interrupted"

	DefaultMaxDownloadBytes int64 = 20 * 1024 * 1024 * 1024
	defaultDialTimeout            = 15 * time.Second
	defaultHeaderTimeout          = 30 * time.Second
	defaultIdleTimeout            = 30 * time.Second
	defaultTotalTimeout           = 2 * time.Hour
)

var (
	ErrDownloadValidation = errors.New("invalid download request")
	ErrDownloadDuplicate  = errors.New("download already exists for this artifact")
	ErrDownloadCancelled  = errors.New("download cancelled")
	modelFilenamePattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,239}\.gguf$`)
	sha256Pattern         = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)
)

// DownloadState is a durable progress snapshot. Values returned by the
// manager are copies, so callers cannot race or mutate manager state.
type DownloadState struct {
	ID             string `json:"id"`
	URL            string `json:"url"`
	DestPath       string `json:"dest_path"`
	Filename       string `json:"filename"`
	ExpectedSHA256 string `json:"expected_sha256"`
	SHA256         string `json:"sha256,omitempty"`
	BytesReceived  int64  `json:"bytes_received"`
	TotalBytes     int64  `json:"total_bytes"`
	Status         string `json:"status"`
	Done           bool   `json:"done"`
	Error          string `json:"error,omitempty"`
	StartTime      int64  `json:"start_time"`
	UpdatedAt      int64  `json:"updated_at"`
}

// DownloadConfig contains the security policy for a DownloadManager. The
// HTTPClient field is intended for hermetic tests; production uses the pinned
// public-address transport created below.
type DownloadConfig struct {
	ModelRoot     string
	TempRoot      string
	ApprovedHosts []string
	MaxBytes      int64
	DialTimeout   time.Duration
	HeaderTimeout time.Duration
	IdleTimeout   time.Duration
	TotalTimeout  time.Duration
	HTTPClient    *http.Client
}

type activeDownload struct {
	cancel context.CancelFunc
}

// DownloadManager persists downloads in the application's existing SQLite
// database. It does not create a second database or trust a request-provided
// destination directory.
type DownloadManager struct {
	mu     sync.RWMutex
	db     *sql.DB
	config DownloadConfig
	active map[string]activeDownload
}

var downloadMigration = []string{
	`CREATE TABLE IF NOT EXISTS download_tasks (
		id TEXT PRIMARY KEY,
		url TEXT NOT NULL,
		filename TEXT NOT NULL,
		dest_path TEXT NOT NULL,
		expected_sha256 TEXT NOT NULL CHECK(length(expected_sha256)=64),
		sha256 TEXT,
		bytes_received INTEGER NOT NULL DEFAULT 0 CHECK(bytes_received>=0),
		total_bytes INTEGER NOT NULL DEFAULT 0 CHECK(total_bytes>=0),
		status TEXT NOT NULL CHECK(status IN ('queued','downloading','verifying','completed','failed','cancelled','interrupted')),
		error_summary TEXT,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		started_at INTEGER,
		finished_at INTEGER
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS download_tasks_destination ON download_tasks(dest_path)`,
	`CREATE INDEX IF NOT EXISTS download_tasks_updated ON download_tasks(updated_at,id)`,
}

func NewDownloadManager() *DownloadManager {
	return NewDownloadManagerWithConfig(DownloadConfig{})
}

func NewDownloadManagerWithConfig(config DownloadConfig) *DownloadManager {
	if config.MaxBytes <= 0 {
		config.MaxBytes = DefaultMaxDownloadBytes
	}
	if config.DialTimeout <= 0 {
		config.DialTimeout = defaultDialTimeout
	}
	if config.HeaderTimeout <= 0 {
		config.HeaderTimeout = defaultHeaderTimeout
	}
	if config.IdleTimeout <= 0 {
		config.IdleTimeout = defaultIdleTimeout
	}
	if config.TotalTimeout <= 0 {
		config.TotalTimeout = defaultTotalTimeout
	}
	if len(config.ApprovedHosts) == 0 {
		config.ApprovedHosts = configuredDownloadHosts()
	}
	return &DownloadManager{config: config, active: make(map[string]activeDownload)}
}

// Configure attaches the manager to the app's existing SQLite database and
// marks work that could not have survived a process restart as interrupted.
func (dm *DownloadManager) Configure(db *sql.DB, modelRoot string) error {
	if db == nil {
		return errors.New("database unavailable")
	}
	if err := persistence.ApplyMigration(db, "downloads/1", downloadMigration...); err != nil {
		return err
	}
	dm.mu.Lock()
	dm.db = db
	dm.config.ModelRoot = modelRoot
	if paths, pathsErr := portable.Resolve(); pathsErr == nil {
		if modelRoot == "" || filepath.Clean(modelRoot) == filepath.Clean(paths.Models) {
			dm.config.TempRoot = paths.Temp
		} else {
			// Test and explicitly selected model roots remain self-contained.
			dm.config.TempRoot = modelRoot
		}
	}
	dm.mu.Unlock()
	_, err := db.Exec(`UPDATE download_tasks SET status='interrupted',error_summary='interrupted by application restart',updated_at=?,finished_at=? WHERE status IN ('downloading','verifying')`, nowMillis(), nowMillis())
	return err
}

// SetModelRoot updates the trusted model root. The route obtains this value
// from EngineInterface; callers cannot supply a destination to StartDownload.
func (dm *DownloadManager) SetModelRoot(modelRoot string) {
	dm.mu.Lock()
	dm.config.ModelRoot = modelRoot
	if paths, err := portable.Resolve(); err == nil && filepath.Clean(modelRoot) == filepath.Clean(paths.Models) {
		dm.config.TempRoot = paths.Temp
	} else if strings.TrimSpace(modelRoot) != "" {
		dm.config.TempRoot = modelRoot
	}
	dm.mu.Unlock()
}

// StartDownload queues a model download beneath the configured model root.
// The expected digest is mandatory because a URL alone is not a trusted
// artifact identity.
func (dm *DownloadManager) StartDownload(rawURL, filename, expectedSHA256 string) (string, error) {
	dm.mu.RLock()
	db, config := dm.db, dm.config
	dm.mu.RUnlock()
	if db == nil {
		return "", errors.New("download persistence unavailable")
	}
	if err := validateModelFilename(filename); err != nil {
		return "", err
	}
	expectedSHA256 = strings.ToLower(strings.TrimSpace(expectedSHA256))
	if !sha256Pattern.MatchString(expectedSHA256) {
		return "", fmt.Errorf("%w: expected_sha256 must be a 64-character SHA-256 digest", ErrDownloadValidation)
	}
	u, err := validateDownloadURL(rawURL, config.ApprovedHosts)
	if err != nil {
		return "", err
	}
	root, err := trustedModelRoot(config.ModelRoot)
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return "", fmt.Errorf("create model root: %w", err)
	}
	tempRoot := root
	if strings.TrimSpace(config.TempRoot) != "" {
		tempRoot, err = trustedModelRoot(config.TempRoot)
		if err != nil {
			return "", fmt.Errorf("prepare download temp root: %w", err)
		}
	}
	dest := filepath.Join(root, filename)
	if filepath.Dir(dest) != root {
		return "", fmt.Errorf("%w: invalid model filename", ErrDownloadValidation)
	}
	config.TempRoot = tempRoot

	now := nowMillis()
	id, err := newUUID()
	if err != nil {
		return "", err
	}
	_, err = db.Exec(`INSERT INTO download_tasks(id,url,filename,dest_path,expected_sha256,status,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)`, id, u.String(), filename, dest, expectedSHA256, now, now)
	if err != nil {
		// A unique destination is the durable duplicate guard. Completed tasks
		// remain stable; failed/interrupted/cancelled tasks may be retried only
		// when no valid artifact exists to protect and no overwrite is possible.
		var existingID, status, priorDigest, existingPath string
		queryErr := db.QueryRow(`SELECT id,status,expected_sha256,dest_path FROM download_tasks WHERE dest_path=?`, dest).Scan(&existingID, &status, &priorDigest, &existingPath)
		if queryErr == nil {
			if status == DownloadCompleted && priorDigest == expectedSHA256 {
				if valid, _, verifyErr := verifyArtifact(existingPath, expectedSHA256); verifyErr == nil && valid {
					return existingID, nil
				}
				return "", fmt.Errorf("%w: existing artifact is missing or invalid", ErrDownloadDuplicate)
			}
			if status == DownloadFailed || status == DownloadCancelled || status == DownloadInterrupted {
				if _, statErr := os.Lstat(existingPath); statErr == nil {
					if valid, _, verifyErr := verifyArtifact(existingPath, expectedSHA256); verifyErr == nil && valid {
						return existingID, nil
					}
					return "", fmt.Errorf("%w: refusing to overwrite an existing artifact", ErrDownloadDuplicate)
				} else if !os.IsNotExist(statErr) {
					return "", fmt.Errorf("%w: cannot inspect existing artifact", ErrDownloadDuplicate)
				}
				if _, resetErr := db.Exec(`UPDATE download_tasks SET url=?,expected_sha256=?,sha256=NULL,bytes_received=0,total_bytes=0,status='queued',error_summary=NULL,updated_at=?,started_at=NULL,finished_at=NULL WHERE id=? AND status IN ('failed','cancelled','interrupted')`, u.String(), expectedSHA256, now, existingID); resetErr == nil {
					id = existingID
				} else {
					return "", resetErr
				}
			} else {
				return "", fmt.Errorf("%w: %s", ErrDownloadDuplicate, filename)
			}
		} else {
			return "", err
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	dm.mu.Lock()
	dm.active[id] = activeDownload{cancel: cancel}
	dm.mu.Unlock()
	go dm.run(ctx, id, u, filename, dest, expectedSHA256, config)
	return id, nil
}

func (dm *DownloadManager) run(ctx context.Context, id string, source *url.URL, filename, dest, expected string, config DownloadConfig) {
	defer func() {
		dm.mu.Lock()
		delete(dm.active, id)
		dm.mu.Unlock()
	}()

	if err := dm.update(id, DownloadDownloading, "", 0, 0, ""); err != nil {
		dm.fail(id, err)
		return
	}
	if valid, size, err := verifyArtifact(dest, expected); err != nil {
		dm.fail(id, err)
		return
	} else if valid {
		_ = dm.update(id, DownloadCompleted, "", size, size, expected)
		return
	} else if _, err := os.Lstat(dest); err == nil {
		dm.fail(id, errors.New("destination already contains an invalid artifact; refusing overwrite"))
		return
	} else if !os.IsNotExist(err) {
		dm.fail(id, err)
		return
	}

	client := configuredHTTPClient(config)
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if _, err := validateDownloadURL(req.URL.String(), config.ApprovedHosts); err != nil {
			return err
		}
		return nil
	}
	requestCtx, cancel := context.WithTimeout(ctx, config.TotalTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, source.String(), nil)
	if err != nil {
		dm.fail(id, err)
		return
	}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			dm.cancelled(id)
		} else {
			dm.fail(id, err)
		}
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		dm.fail(id, fmt.Errorf("download source returned HTTP %d", resp.StatusCode))
		return
	}
	if resp.ContentLength > config.MaxBytes {
		dm.fail(id, fmt.Errorf("download exceeds maximum size of %d bytes", config.MaxBytes))
		return
	}
	if err = dm.update(id, DownloadDownloading, "", 0, maxInt64(resp.ContentLength, 0), ""); err != nil {
		dm.fail(id, err)
		return
	}

	temp, err := os.OpenFile(filepath.Join(config.TempRoot, ".download-"+id+".part"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		dm.fail(id, err)
		return
	}
	tempPath := temp.Name()
	removeTemp := true
	defer func() {
		_ = temp.Close()
		if removeTemp {
			_ = os.Remove(tempPath)
		}
	}()

	hash := sha256.New()
	buf := make([]byte, 32*1024)
	var received int64
	for {
		n, readErr := readWithIdleTimeout(ctx, resp.Body, buf, config.IdleTimeout)
		if n > 0 {
			if received+int64(n) > config.MaxBytes {
				dm.fail(id, fmt.Errorf("download exceeds maximum size of %d bytes", config.MaxBytes))
				return
			}
			if _, err = temp.Write(buf[:n]); err != nil {
				dm.fail(id, err)
				return
			}
			_, _ = hash.Write(buf[:n])
			received += int64(n)
			if err = dm.update(id, DownloadDownloading, "", received, maxInt64(resp.ContentLength, 0), ""); err != nil {
				dm.fail(id, err)
				return
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				break
			}
			if errors.Is(ctx.Err(), context.Canceled) {
				dm.cancelled(id)
			} else {
				dm.fail(id, readErr)
			}
			return
		}
	}
	if err = temp.Sync(); err != nil {
		dm.fail(id, err)
		return
	}
	if err = temp.Close(); err != nil {
		dm.fail(id, err)
		return
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if err = dm.update(id, DownloadVerifying, "", received, received, actual); err != nil {
		dm.fail(id, err)
		return
	}
	if actual != expected {
		dm.fail(id, fmt.Errorf("SHA-256 mismatch: got %s, expected %s", actual, expected))
		return
	}

	// Cancellation and finalization serialize on dm.mu. Once cancellation has
	// won this lock, the worker cannot link the temporary file into place.
	dm.mu.Lock()
	if dm.isCancelledLocked(id) || ctx.Err() != nil {
		dm.mu.Unlock()
		dm.cancelled(id)
		return
	}
	if valid, size, verifyErr := verifyArtifact(dest, expected); verifyErr != nil {
		dm.mu.Unlock()
		dm.fail(id, verifyErr)
		return
	} else if valid {
		dm.mu.Unlock()
		_ = dm.update(id, DownloadCompleted, "", size, size, expected)
		return
	} else if _, statErr := os.Lstat(dest); statErr == nil {
		dm.mu.Unlock()
		dm.fail(id, errors.New("destination appeared with an invalid artifact; refusing overwrite"))
		return
	}
	linkErr := os.Link(tempPath, dest)
	if linkErr == nil {
		removeTemp = false
		_ = os.Remove(tempPath)
		// Keep the cancellation lock through the durable terminal transition.
		// A cancellation arriving after the link therefore observes completed
		// and cannot turn a finalized artifact into a cancelled task.
		_ = dm.update(id, DownloadCompleted, "", received, received, actual)
		dm.mu.Unlock()
		return
	}
	dm.mu.Unlock()
	if linkErr != nil {
		if valid, size, verifyErr := verifyArtifact(dest, expected); verifyErr == nil && valid {
			_ = dm.update(id, DownloadCompleted, "", size, size, expected)
		} else {
			dm.fail(id, fmt.Errorf("atomic artifact finalization: %w", linkErr))
		}
		return
	}
}

func (dm *DownloadManager) update(id, status, errSummary string, received, total int64, digest string) error {
	if status == DownloadCompleted || status == DownloadFailed || status == DownloadCancelled {
		if errSummary == "" && status != DownloadCompleted {
			errSummary = status
		}
	}
	now := nowMillis()
	allowed := "status IN ('queued','downloading','verifying')"
	finished := false
	switch status {
	case DownloadDownloading:
		allowed = "status IN ('queued','downloading')"
	case DownloadVerifying:
		allowed = "status IN ('downloading','verifying')"
	case DownloadCompleted:
		allowed = "status IN ('downloading','verifying')"
		finished = true
	case DownloadFailed:
		allowed = "status IN ('queued','downloading','verifying','interrupted')"
		finished = true
	case DownloadCancelled:
		allowed = "status IN ('queued','downloading','verifying','interrupted')"
		finished = true
	default:
		return fmt.Errorf("unknown download status %q", status)
	}
	var result sql.Result
	var err error
	if finished {
		result, err = dm.db.Exec(`UPDATE download_tasks SET status=?,sha256=NULLIF(?,''),bytes_received=?,total_bytes=?,error_summary=NULLIF(?,''),updated_at=?,finished_at=? WHERE id=? AND `+allowed, status, digest, received, total, errSummary, now, now, id)
	} else {
		result, err = dm.db.Exec(`UPDATE download_tasks SET status=?,sha256=NULLIF(?,''),bytes_received=?,total_bytes=?,error_summary=NULLIF(?,''),updated_at=?,started_at=COALESCE(started_at,?) WHERE id=? AND `+allowed, status, digest, received, total, errSummary, now, now, id)
	}
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return ErrDownloadCancelled
	}
	return nil
}

func (dm *DownloadManager) fail(id string, err error) {
	if errors.Is(err, ErrDownloadCancelled) || dm.isCancelled(id) {
		dm.cancelled(id)
		return
	}
	_ = dm.update(id, DownloadFailed, err.Error(), 0, 0, "")
}

func (dm *DownloadManager) cancelled(id string) {
	_ = dm.update(id, DownloadCancelled, ErrDownloadCancelled.Error(), 0, 0, "")
}

func (dm *DownloadManager) isCancelled(id string) bool {
	var status string
	return dm.db.QueryRow(`SELECT status FROM download_tasks WHERE id=?`, id).Scan(&status) == nil && status == DownloadCancelled
}

func (dm *DownloadManager) isCancelledLocked(id string) bool {
	return dm.isCancelled(id)
}

// Cancel stops an active transfer and durably records cancellation. A worker
// that races with cancellation is prevented from finalizing by the lock and
// status check in run.
func (dm *DownloadManager) Cancel(id string) error {
	dm.mu.Lock()
	active, ok := dm.active[id]
	if ok {
		active.cancel()
	}
	result, err := dm.db.Exec(`UPDATE download_tasks SET status='cancelled',error_summary=?,updated_at=?,finished_at=? WHERE id=? AND status IN ('queued','downloading','verifying','interrupted')`, ErrDownloadCancelled.Error(), nowMillis(), nowMillis(), id)
	dm.mu.Unlock()
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected == 0 && !ok {
		var status string
		if err = dm.db.QueryRow(`SELECT status FROM download_tasks WHERE id=?`, id).Scan(&status); errors.Is(err, sql.ErrNoRows) {
			return sql.ErrNoRows
		}
	}
	return nil
}

func (dm *DownloadManager) CancelAll() {
	dm.mu.RLock()
	ids := make([]string, 0, len(dm.active))
	for id := range dm.active {
		ids = append(ids, id)
	}
	dm.mu.RUnlock()
	for _, id := range ids {
		_ = dm.Cancel(id)
	}
}

// GetProgress returns a copied, SQLite-authoritative snapshot.
func (dm *DownloadManager) GetProgress(id string) (*DownloadState, bool) {
	state, err := dm.load(id)
	return state, err == nil
}

func (dm *DownloadManager) ListProgress() ([]DownloadState, error) {
	rows, err := dm.db.Query(`SELECT id,url,dest_path,filename,expected_sha256,COALESCE(sha256,''),bytes_received,total_bytes,status,COALESCE(error_summary,''),COALESCE(started_at,created_at),updated_at FROM download_tasks ORDER BY created_at,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]DownloadState, 0)
	for rows.Next() {
		state, err := scanState(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *state)
	}
	return result, rows.Err()
}

func (dm *DownloadManager) load(id string) (*DownloadState, error) {
	return scanState(dm.db.QueryRow(`SELECT id,url,dest_path,filename,expected_sha256,COALESCE(sha256,''),bytes_received,total_bytes,status,COALESCE(error_summary,''),COALESCE(started_at,created_at),updated_at FROM download_tasks WHERE id=?`, id))
}

type scanner interface{ Scan(...interface{}) error }

func scanState(row scanner) (*DownloadState, error) {
	var state DownloadState
	if err := row.Scan(&state.ID, &state.URL, &state.DestPath, &state.Filename, &state.ExpectedSHA256, &state.SHA256, &state.BytesReceived, &state.TotalBytes, &state.Status, &state.Error, &state.StartTime, &state.UpdatedAt); err != nil {
		return nil, err
	}
	state.Done = state.Status == DownloadCompleted
	return &state, nil
}

func validateModelFilename(filename string) error {
	if filename == "" || filepath.Base(filename) != filename || strings.ContainsAny(filename, `/\\`) || filename == "." || filename == ".." || !modelFilenamePattern.MatchString(filename) {
		return fmt.Errorf("%w: filename must be a safe .gguf model filename", ErrDownloadValidation)
	}
	return nil
}

func trustedModelRoot(root string) (string, error) {
	if strings.TrimSpace(root) == "" {
		return "", fmt.Errorf("%w: model root is not configured", ErrDownloadValidation)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	abs = filepath.Clean(abs)
	if err = os.MkdirAll(abs, 0700); err != nil {
		return "", fmt.Errorf("create model root: %w", err)
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return "", fmt.Errorf("inspect model root: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return "", fmt.Errorf("%w: model root must be a real directory", ErrDownloadValidation)
	}
	realRoot, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("resolve model root: %w", err)
	}
	realInfo, err := os.Stat(realRoot)
	if err != nil || !realInfo.IsDir() {
		return "", fmt.Errorf("%w: model root must be a directory", ErrDownloadValidation)
	}
	return filepath.Clean(realRoot), nil
}

func validateDownloadURL(raw string, approved []string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return nil, fmt.Errorf("%w: only approved HTTPS download URLs are allowed", ErrDownloadValidation)
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || !approvedHost(host, approved) {
		return nil, fmt.Errorf("%w: download source is not approved", ErrDownloadValidation)
	}
	if ip := net.ParseIP(host); ip != nil && blockedDownloadIP(ip) {
		return nil, fmt.Errorf("%w: download source resolves to a private or reserved address", ErrDownloadValidation)
	}
	return u, nil
}

func approvedHost(host string, approved []string) bool {
	for _, raw := range approved {
		entry := strings.ToLower(strings.TrimSpace(raw))
		if entry == "" {
			continue
		}
		entry = strings.TrimPrefix(entry, "*.")
		if host == entry || strings.HasSuffix(host, "."+entry) {
			return true
		}
	}
	return false
}

func configuredDownloadHosts() []string {
	result := []string{"huggingface.co", "hf.co", "github.com", "raw.githubusercontent.com", "objects.githubusercontent.com"}
	for _, envName := range []string{"AI_SERVER_APPROVED_DOWNLOAD_HOSTS", "AI_SERVER_DOWNLOAD_ALLOWED_HOSTS"} {
		for _, value := range strings.Split(os.Getenv(envName), ",") {
			if value = strings.TrimSpace(value); value != "" {
				result = append(result, value)
			}
		}
	}
	return result
}

func configuredHTTPClient(config DownloadConfig) *http.Client {
	if config.HTTPClient != nil {
		copy := *config.HTTPClient
		return &copy
	}
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           publicDownloadDialContext(config.DialTimeout),
		TLSHandshakeTimeout:   config.DialTimeout,
		ResponseHeaderTimeout: config.HeaderTimeout,
		IdleConnTimeout:       config.IdleTimeout,
		DisableKeepAlives:     true,
	}
	return &http.Client{Transport: transport, Timeout: config.TotalTimeout}
}

func publicDownloadDialContext(timeout time.Duration) func(context.Context, string, string) (net.Conn, error) {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil || len(ips) == 0 {
			if err == nil {
				err = errors.New("download source has no addresses")
			}
			return nil, err
		}
		dialer := net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}
		var last error
		for _, resolved := range ips {
			if blockedDownloadIP(resolved.IP) {
				return nil, errors.New("download source resolved to a private or reserved address")
			}
			conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(resolved.IP.String(), port))
			if dialErr == nil {
				return conn, nil
			}
			last = dialErr
		}
		return nil, last
	}
}

func blockedDownloadIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() || ip.IsPrivate() {
		return true
	}
	for _, cidr := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32"} {
		_, block, _ := net.ParseCIDR(cidr)
		if block.Contains(ip) {
			return true
		}
	}
	return false
}

func verifyArtifact(path, expected string) (bool, int64, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, 0, nil
		}
		return false, 0, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return false, 0, errors.New("destination is not a regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return false, 0, err
	}
	hash := sha256.New()
	_, copyErr := io.Copy(hash, f)
	closeErr := f.Close()
	if copyErr != nil {
		return false, 0, copyErr
	}
	if closeErr != nil {
		return false, 0, closeErr
	}
	return hex.EncodeToString(hash.Sum(nil)) == expected, info.Size(), nil
}

func readWithIdleTimeout(ctx context.Context, body io.ReadCloser, buf []byte, timeout time.Duration) (int, error) {
	type result struct {
		n   int
		err error
	}
	readResult := make(chan result, 1)
	go func() {
		n, err := body.Read(buf)
		readResult <- result{n: n, err: err}
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case result := <-readResult:
		return result.n, result.err
	case <-ctx.Done():
		_ = body.Close()
		return 0, ctx.Err()
	case <-timer.C:
		_ = body.Close()
		return 0, errors.New("download idle timeout")
	}
}

func newUUID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}

func nowMillis() int64 { return time.Now().UTC().UnixMilli() }

func maxInt64(value, fallback int64) int64 {
	if value > 0 {
		return value
	}
	return fallback
}
