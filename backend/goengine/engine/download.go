package engine

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// DownloadState tracks a file download
type DownloadState struct {
	URL           string `json:"url"`
	DestPath      string `json:"dest_path"`
	BytesReceived int64  `json:"bytes_received"`
	TotalBytes    int64  `json:"total_bytes"`
	Done          bool   `json:"done"`
	Error         string `json:"error,omitempty"`
	StartTime     int64  `json:"start_time"`
}

// DownloadManager manages file downloads
type DownloadManager struct {
	mu        sync.RWMutex
	downloads map[string]*DownloadState
}

// NewDownloadManager creates a new download manager
func NewDownloadManager() *DownloadManager {
	return &DownloadManager{
		downloads: make(map[string]*DownloadState),
	}
}

// StartDownload begins downloading a file
func (dm *DownloadManager) StartDownload(url, destDir, filename string) error {
	dm.mu.Lock()
	existing, exists := dm.downloads[filename]
	if exists && !existing.Done {
		dm.mu.Unlock()
		return fmt.Errorf("download already in progress for this filename")
	}

	state := &DownloadState{
		URL:       url,
		DestPath:  filepath.Join(destDir, filename),
		StartTime: time.Now().UnixMilli(),
	}
	dm.downloads[filename] = state
	dm.mu.Unlock()

	// Create dest directory
	if err := os.MkdirAll(destDir, 0755); err != nil {
		state.Error = err.Error()
		state.Done = true
		return err
	}

	go func() {
		resp, err := http.Get(url)
		if err != nil {
			state.Error = err.Error()
			state.Done = true
			return
		}
		defer resp.Body.Close()

		dm.mu.Lock()
		state.TotalBytes = resp.ContentLength
		dm.mu.Unlock()

		file, err := os.Create(state.DestPath)
		if err != nil {
			dm.mu.Lock()
			state.Error = err.Error()
			state.Done = true
			dm.mu.Unlock()
			return
		}
		defer file.Close()

		buf := make([]byte, 32*1024)
		for {
			n, err := resp.Body.Read(buf)
			if n > 0 {
				if _, werr := file.Write(buf[:n]); werr != nil {
					dm.mu.Lock()
					state.Error = werr.Error()
					state.Done = true
					dm.mu.Unlock()
					return
				}
				dm.mu.Lock()
				state.BytesReceived += int64(n)
				dm.mu.Unlock()
			}
			if err != nil {
				if err != io.EOF {
					dm.mu.Lock()
					state.Error = err.Error()
					dm.mu.Unlock()
				}
				break
			}
		}

		dm.mu.Lock()
		state.Done = true
		dm.mu.Unlock()
		log.Printf("[Download] Complete: %s (%d bytes)\n", filename, state.BytesReceived)
	}()

	return nil
}

// GetProgress returns download progress for a filename
func (dm *DownloadManager) GetProgress(filename string) (*DownloadState, bool) {
	dm.mu.RLock()
	defer dm.mu.RUnlock()

	state, exists := dm.downloads[filename]
	return state, exists
}
