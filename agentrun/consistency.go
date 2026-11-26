package agentrun

// ConsistencyReport is a read-only health snapshot used at startup diagnostics
// and migration tests. Non-zero counters are actionable data-repair findings;
// this method never mutates or resumes a run.
type ConsistencyReport struct {
	MissingTaskRuns        int `json:"missingTaskRuns"`
	OrphanEvents           int `json:"orphanEvents"`
	OrphanCheckpoints      int `json:"orphanCheckpoints"`
	OwnerMismatches        int `json:"ownerMismatches"`
	InvalidTaskStatuses    int `json:"invalidTaskStatuses"`
	TerminalTimeMismatches int `json:"terminalTimeMismatches"`
	EventSequenceGaps      int `json:"eventSequenceGaps"`
}

func (r *SQLiteRepository) CheckConsistency() (ConsistencyReport, error) {
	var report ConsistencyReport
	queries := []struct {
		dest *int
		sql  string
	}{
		{&report.MissingTaskRuns, `SELECT COUNT(*) FROM agent_runs a LEFT JOIN task_runs t ON t.id=a.id WHERE t.id IS NULL`},
		{&report.OrphanEvents, `SELECT COUNT(*) FROM run_events e LEFT JOIN task_runs t ON t.id=e.run_id WHERE t.id IS NULL`},
		{&report.OrphanCheckpoints, `SELECT COUNT(*) FROM run_checkpoints c LEFT JOIN task_runs t ON t.id=c.run_id WHERE t.id IS NULL`},
		{&report.OwnerMismatches, `SELECT COUNT(*) FROM agent_runs a JOIN task_runs t ON t.id=a.id WHERE a.owner_id<>t.owner_id`},
		{&report.InvalidTaskStatuses, `SELECT COUNT(*) FROM task_runs WHERE status NOT IN ('queued','validating','running','waiting','waiting_approval','blocked_policy','succeeded','failed','cancelled','interrupted')`},
		{&report.TerminalTimeMismatches, `SELECT COUNT(*) FROM task_runs WHERE (status IN ('succeeded','failed','cancelled','interrupted') AND finished_at IS NULL) OR (status NOT IN ('succeeded','failed','cancelled','interrupted') AND finished_at IS NOT NULL)`},
	}
	for _, query := range queries {
		if err := r.db.QueryRow(query.sql).Scan(query.dest); err != nil {
			return report, err
		}
	}
	rows, err := r.db.Query(`SELECT run_id,sequence FROM run_events ORDER BY run_id,sequence`)
	if err != nil {
		return report, err
	}
	defer rows.Close()
	var runID string
	var sequence, expected uint64
	for rows.Next() {
		var current string
		if err = rows.Scan(&current, &sequence); err != nil {
			return report, err
		}
		if current != runID {
			runID, expected = current, 1
		}
		if sequence != expected {
			report.EventSequenceGaps++
		}
		expected = sequence + 1
	}
	if err = rows.Err(); err != nil {
		return report, err
	}
	return report, nil
}
