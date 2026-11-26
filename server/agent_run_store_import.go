package server

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ai-server-studio-backend/agentrun"
)

// Migration is opt-in for ownership. AI_SERVER_AGENT_RUN_OWNER_MAP points to a
// JSON object mapping each legacy run ID to an existing authenticated user ID.
func (s *Server) importLegacyAgentRuns(repo *agentrun.SQLiteRepository, dataDir string) error {
	source := strings.TrimSpace(os.Getenv("AI_SERVER_LEGACY_AGENT_RUN_DIR"))
	if source == "" {
		source = filepath.Join(dataDir, "agent-runs")
	}
	owners := map[string]string{}
	if mapping := strings.TrimSpace(os.Getenv("AI_SERVER_AGENT_RUN_OWNER_MAP")); mapping != "" {
		raw, err := os.ReadFile(mapping)
		if err != nil {
			return err
		}
		if err = json.Unmarshal(raw, &owners); err != nil {
			return errors.New("invalid legacy run ownership map")
		}
		for _, owner := range owners {
			var count int
			if err = s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE id=?`, owner).Scan(&count); err != nil {
				return err
			}
			if count != 1 {
				return errors.New("legacy run ownership map references unknown user")
			}
		}
	}
	report, err := repo.ImportJSON(source, filepath.Join(dataDir, "backups", "agent-runs"), owners)
	if errors.Is(err, agentrun.ErrOwnershipMapping) {
		log.Printf("Legacy agent run migration blocked: %d runs require explicit ownership mapping (AI_SERVER_AGENT_RUN_OWNER_MAP); originals retained", len(report.Blocked))
		return nil
	}
	if err != nil {
		return err
	}
	if report.Imported > 0 {
		log.Printf("Imported %d legacy agent runs; originals and verified backups retained", report.Imported)
	}
	return nil
}
