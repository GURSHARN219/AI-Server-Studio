package agentrun

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var ErrOwnershipMapping = errors.New("legacy run import blocked: explicit ownership mapping required")

type ImportReport struct {
	Imported int      `json:"imported"`
	Skipped  int      `json:"skipped"`
	Blocked  []string `json:"blocked,omitempty"`
}

// ImportJSON requires an administrator-provided run-ID -> owner-ID mapping for
// every source, including documents carrying an owner field. The caller must
// validate mapped owners against its identity store. It never infers ownership.
// Originals remain intact; hash-addressed backups precede the atomic import.
func (r *SQLiteRepository) ImportJSON(dir, backupDir string, owners map[string]string) (ImportReport, error) {
	report := ImportReport{}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return report, err
	}
	info, err := os.Lstat(abs)
	if errors.Is(err, os.ErrNotExist) {
		return report, nil
	}
	if err != nil {
		return report, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return report, errors.New("legacy run source must be a directory")
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return report, err
	}
	type document struct {
		path, hash string
		raw        []byte
		run        Run
	}
	documents := make([]document, 0)
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		if !entry.Type().IsRegular() {
			return report, ErrCorrupt
		}
		path := filepath.Join(abs, entry.Name())
		raw, err := os.ReadFile(path)
		if err != nil {
			return report, err
		}
		var file runFile
		if err = json.Unmarshal(raw, &file); err != nil {
			return report, fmt.Errorf("%w: invalid legacy document", ErrCorrupt)
		}
		if file.SchemaVersion != SchemaVersion {
			return report, ErrSchemaVersion
		}
		if err = validateRun(file.Run); err != nil {
			return report, err
		}
		if entry.Name() != file.Run.ID+".json" {
			return report, ErrCorrupt
		}
		sum := sha256.Sum256(raw)
		hash := hex.EncodeToString(sum[:])
		owner := strings.TrimSpace(owners[file.Run.ID])
		var priorHash, priorRunID, priorOwner string
		var priorVersion int
		err = r.db.QueryRow(`SELECT i.sha256,i.version,i.run_id,r.owner_id FROM agent_run_imports i JOIN task_runs r ON r.id=i.run_id WHERE i.source=?`, path).Scan(&priorHash, &priorVersion, &priorRunID, &priorOwner)
		if err == nil {
			if priorHash != hash || priorVersion != SchemaVersion || priorRunID != file.Run.ID {
				return report, errors.New("legacy import source changed after migration")
			}
			// A completed marker is sufficient to replay the same source without
			// keeping an ownership-map file configured forever. It never assigns
			// new data, and a changed mapping still fails closed.
			if owner != "" && owner != priorOwner {
				report.Blocked = append(report.Blocked, file.Run.ID)
				continue
			}
			owner = priorOwner
		} else if !errors.Is(err, sql.ErrNoRows) {
			return report, err
		}
		if owner == "" || (file.Run.OwnerID != "" && file.Run.OwnerID != owner) {
			report.Blocked = append(report.Blocked, file.Run.ID)
			continue
		}
		file.Run.OwnerID = owner
		if file.Run.Revision == 0 {
			// Schema v1 did not require revisions. Establish the repository's
			// initial revision only for those older documents; preserve any
			// revision that was already recorded.
			file.Run.Revision = 1
		}
		documents = append(documents, document{path, hash, raw, file.Run})
	}
	if len(report.Blocked) > 0 {
		return report, ErrOwnershipMapping
	}
	if len(documents) == 0 {
		return report, nil
	}
	if err = os.MkdirAll(backupDir, 0700); err != nil {
		return report, err
	}
	for _, doc := range documents {
		path := filepath.Join(backupDir, doc.run.ID+"-v1-"+doc.hash+".json")
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if errors.Is(err, os.ErrExist) {
			info, statErr := os.Lstat(path)
			if statErr != nil || !info.Mode().IsRegular() {
				return report, errors.New("unsafe legacy backup destination")
			}
			existing, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(existing, doc.raw) {
				return report, errors.New("legacy backup verification failed")
			}
			continue
		}
		if err != nil {
			return report, err
		}
		_, err = f.Write(doc.raw)
		if err == nil {
			err = f.Sync()
		}
		closeErr := f.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			os.Remove(path)
			return report, err
		}
	}
	tx, err := r.db.Begin()
	if err != nil {
		return report, err
	}
	defer tx.Rollback()
	imported, skipped := 0, 0
	for _, doc := range documents {
		var hash string
		var version, eventCount int
		var runID string
		err = tx.QueryRow(`SELECT sha256,version,run_id,event_count FROM agent_run_imports WHERE source=?`, doc.path).Scan(&hash, &version, &runID, &eventCount)
		if err == nil {
			if hash != doc.hash || version != SchemaVersion || runID != doc.run.ID || eventCount != len(doc.run.Events) {
				return report, errors.New("legacy import source changed after migration")
			}
			skipped++
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return report, err
		}
		var count int
		if err = tx.QueryRow(`SELECT COUNT(*) FROM task_runs WHERE id=?`, doc.run.ID).Scan(&count); err != nil {
			return report, err
		}
		if count != 0 {
			return report, fmt.Errorf("legacy import run identity already exists: %s", doc.run.ID)
		}
		if err = saveSQLiteRunWithInitialRevision(tx, doc.run, true); err != nil {
			return report, err
		}
		if err = tx.QueryRow(`SELECT COUNT(*) FROM run_events WHERE run_id=?`, doc.run.ID).Scan(&count); err != nil {
			return report, err
		}
		if count != len(doc.run.Events) {
			return report, errors.New("legacy event count verification failed")
		}
		if err = tx.QueryRow(`SELECT COUNT(*) FROM run_checkpoints WHERE run_id=?`, doc.run.ID).Scan(&count); err != nil {
			return report, err
		}
		want := 0
		if doc.run.Checkpoint != nil {
			want = 1
		}
		if count != want {
			return report, errors.New("legacy checkpoint count verification failed")
		}
		if _, err = tx.Exec(`INSERT INTO agent_run_imports VALUES(?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
			doc.path, doc.hash, SchemaVersion, doc.run.ID, len(doc.run.Events)); err != nil {
			return report, err
		}
		imported++
	}
	if err = tx.Commit(); err != nil {
		return report, err
	}
	report.Imported, report.Skipped = imported, skipped
	return report, nil
}
