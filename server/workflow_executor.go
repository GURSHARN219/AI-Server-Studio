package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"

	"ai-server-studio-backend/agentrun"
	"ai-server-studio-backend/workflow"
)

const workflowAgentDefaultIterations = 8

type workflowAgentPromptInput struct {
	Type          string         `json:"type"`
	Prompt        string         `json:"prompt"`
	ModelName     string         `json:"modelName"`
	ProviderID    string         `json:"providerId"`
	SessionID     string         `json:"sessionId"`
	ExecutionMode string         `json:"executionMode"`
	MaxIterations *int           `json:"maxIterations"`
	Tools         []agentToolDef `json:"tools"`
}

type workflowAgentExecutionPlan struct {
	request      agentRunCreateReq
	metadata     map[string]interface{}
	policyReason string
	policyCode   string
}

type workflowExecutionAdapter struct {
	server *Server
}

func (s *Server) newWorkflowExecutionAdapter() workflow.ExecutionExecutor {
	return &workflowExecutionAdapter{server: s}
}

func (s *Server) executeWorkflowRun(ctx context.Context, ownerID, runID string) (workflow.WorkflowRun, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if s == nil || s.trustedOrchestrator == nil {
		return workflow.WorkflowRun{}, errors.New("workflow executor is not configured")
	}
	if err := s.beginWorkflowExecution(runID); err != nil {
		return workflow.WorkflowRun{}, err
	}
	defer s.endWorkflowExecution(runID)
	return s.trustedOrchestrator.Run(ctx, ownerID, runID)
}

// beginWorkflowExecution coordinates the in-process lifecycle with recovery.
// SQLite revisions remain the durable correctness boundary; this guard only
// prevents startup recovery from interrupting work running in this process.
func (s *Server) beginWorkflowExecution(runID string) error {
	s.workflowCoordMu.Lock()
	defer s.workflowCoordMu.Unlock()
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if s.closing {
		return errors.New("server is shutting down")
	}
	if s.activeWorkflowRuns == nil {
		s.activeWorkflowRuns = make(map[string]struct{})
	}
	s.activeWorkflowRuns[runID] = struct{}{}
	s.runWG.Add(1)
	return nil
}

func (s *Server) endWorkflowExecution(runID string) {
	s.workflowCoordMu.Lock()
	delete(s.activeWorkflowRuns, runID)
	s.workflowCoordMu.Unlock()
	s.runWG.Done()
}

// recoverWorkflows is intentionally internal: recovery is a startup and test
// operation, not a public workflow transition endpoint.
func (s *Server) recoverWorkflows() (workflow.RecoveryReport, error) {
	if s == nil || s.workflows == nil {
		return workflow.RecoveryReport{}, errors.New("workflow store unavailable")
	}
	s.workflowCoordMu.Lock()
	defer s.workflowCoordMu.Unlock()
	s.lifecycleMu.Lock()
	closing := s.closing
	s.lifecycleMu.Unlock()
	if closing {
		return workflow.RecoveryReport{}, errors.New("server is shutting down")
	}
	if s.workflowRecovery == nil {
		s.workflowRecovery = workflow.NewRecoveryService(s.workflows)
	}
	report, err := s.workflowRecovery.RecoverWithGuard(func(runID string) bool {
		_, active := s.activeWorkflowRuns[runID]
		return active
	})
	for _, issue := range report.Issues {
		log.Printf("workflow recovery run_id=%s step_id=%s classification=%s reason_code=%s reconciled=%t skipped=%t error=%s", issue.RunID, issue.StepID, issue.Classification, issue.ReasonCode, issue.Reconciled, issue.Skipped, issue.Error)
	}
	return report, err
}

func (a *workflowExecutionAdapter) Execute(ctx context.Context, intent workflow.DispatchIntent) (workflow.ExecutionResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if a == nil || a.server == nil || a.server.agentRuns == nil {
		return workflow.ExecutionResult{AgentRunID: intent.AgentRunID, Status: workflow.RunFailed, ErrorCode: "executor_unavailable", ErrorSummary: "workflow executor unavailable"}, errors.New("workflow executor unavailable")
	}
	if existing, ok := a.server.agentRuns.get(intent.AgentRunID); ok {
		state := existing.snapshot()
		if state.Status.Terminal() {
			return workflowResultFromAgent(state), nil
		}
	}

	plan := a.server.prepareWorkflowAgentPlan(intent)
	goal := plan.request.Goal
	if strings.TrimSpace(goal) == "" {
		goal = "workflow step " + intent.StepID
	}
	modelName := plan.request.ModelName
	metadata := plan.metadata
	ownerID := intentOwner(intent, a.server)
	run, err := a.server.agentRuns.createWithID(intent.AgentRunID, goal, modelName, ownerID, plan.request.SessionID, metadata)
	if err != nil {
		return workflow.ExecutionResult{AgentRunID: intent.AgentRunID, Status: workflow.RunFailed, ErrorCode: "agent_persistence_error", ErrorSummary: "failed to persist agent run"}, errors.New("failed to persist agent run")
	}
	state := run.snapshot()
	if state.ID != intent.AgentRunID {
		return workflow.ExecutionResult{AgentRunID: intent.AgentRunID, Status: workflow.RunFailed, ErrorCode: "agent_identity_error", ErrorSummary: "agent run identity mismatch"}, errors.New("agent run identity mismatch")
	}
	if state.Status.Terminal() {
		return workflowResultFromAgent(state), nil
	}

	claimed, err := run.claimExecution()
	if err != nil {
		return workflow.ExecutionResult{AgentRunID: intent.AgentRunID, Status: workflow.RunFailed, ErrorCode: "agent_persistence_error", ErrorSummary: "failed to claim agent execution"}, errors.New("failed to claim agent execution")
	}
	if !claimed {
		return workflowResultFromAgent(run.snapshot()), nil
	}

	if plan.policyReason != "" {
		if plan.policyCode == "invalid_input" {
			return a.finishAgentFailure(run, intent.AgentRunID, "invalid_input", "workflow agent input is invalid")
		}
		return a.finishPolicyRun(run, intent.AgentRunID, plan.policyCode, plan.policyReason)
	}

	stepID := intent.StepID
	if err := run.record("step_started", map[string]interface{}{"step": map[string]interface{}{"id": stepID, "description": goal, "status": "running"}}, &agentrun.RunCheckpoint{Boundary: "step_started", StepID: stepID}); err != nil {
		return a.failPersistedAgent(run, intent.AgentRunID, "agent_persistence_error", "failed to persist agent step start")
	}

	answer, execErr := a.server.executeAgentStepContext(ctx, run, plan.request, stepID, goal, nil, plan.request.MaxIterations)
	if execErr != nil {
		if isWorkflowInterrupted(ctx, execErr) {
			return a.finishInterruptedRun(run, intent.AgentRunID)
		}
		return a.finishAgentFailure(run, intent.AgentRunID, "agent_execution_failed", "agent execution failed")
	}
	if err := run.record("step_done", map[string]interface{}{"stepId": stepID, "answer": answer}, &agentrun.RunCheckpoint{Boundary: "step_completed", StepID: stepID, Completed: []string{answer}}); err != nil {
		return a.failPersistedAgent(run, intent.AgentRunID, "agent_persistence_error", "failed to persist agent step completion")
	}
	changed, finishErr := run.finish(agentrun.StatusDone, "", answer, 1)
	if finishErr != nil || !changed {
		if finishErr != nil {
			return a.failPersistedAgent(run, intent.AgentRunID, "agent_persistence_error", "failed to persist agent completion")
		}
		if result := workflowResultFromAgent(run.snapshot()); result.Status == workflow.RunSucceeded {
			return result, nil
		}
		return workflow.ExecutionResult{AgentRunID: intent.AgentRunID, Status: workflow.RunFailed, ErrorCode: "agent_persistence_error", ErrorSummary: "agent completion was not persisted"}, errors.New("agent completion was not persisted")
	}
	output, _ := json.Marshal(answer)
	return workflow.ExecutionResult{AgentRunID: intent.AgentRunID, Status: workflow.RunSucceeded, Output: output}, nil
}

func intentOwner(intent workflow.DispatchIntent, s *Server) string {
	if strings.TrimSpace(intent.OwnerID) != "" {
		return intent.OwnerID
	}
	// The workflow repository has already authenticated and owner-scoped the
	// dispatch. The agent row itself carries the authoritative owner; loading it
	// here avoids placing ownership in untrusted dispatch metadata.
	states, err := s.agentRuns.repo.List()
	if err == nil {
		for _, state := range states {
			if state.ID == intent.AgentRunID {
				return state.OwnerID
			}
		}
	}
	return ""
}

func (a *workflowExecutionAdapter) finishPolicyRun(run *agentRun, id, code, reason string) (workflow.ExecutionResult, error) {
	if code == "" {
		code = "policy_denied"
	}
	changed, err := run.finish(agentrun.StatusError, "policy denied", "", 0)
	if err != nil {
		return a.failPersistedAgent(run, id, "agent_persistence_error", "failed to persist policy outcome")
	}
	if !changed && !run.isTerminal() {
		return a.failPersistedAgent(run, id, "agent_persistence_error", "policy outcome was not persisted")
	}
	return workflow.ExecutionResult{AgentRunID: id, Status: workflow.RunBlockedPolicy, ErrorCode: code, ErrorSummary: reason}, nil
}

func (a *workflowExecutionAdapter) finishAgentFailure(run *agentRun, id, code, reason string) (workflow.ExecutionResult, error) {
	changed, err := run.finish(agentrun.StatusError, reason, "", 0)
	if err != nil || (!changed && !run.isTerminal()) {
		return a.failPersistedAgent(run, id, "agent_persistence_error", "failed to persist agent failure")
	}
	return workflow.ExecutionResult{AgentRunID: id, Status: workflow.RunFailed, ErrorCode: code, ErrorSummary: reason}, nil
}

func (a *workflowExecutionAdapter) finishInterruptedRun(run *agentRun, id string) (workflow.ExecutionResult, error) {
	changed, err := run.finish(agentrun.StatusError, "execution interrupted", "", 0)
	if err != nil || (!changed && !run.isTerminal()) {
		return a.failPersistedAgent(run, id, "agent_persistence_error", "failed to persist agent interruption")
	}
	return workflow.ExecutionResult{AgentRunID: id, Status: workflow.RunInterrupted, ErrorCode: "execution_interrupted", ErrorSummary: "execution interrupted"}, nil
}

func (a *workflowExecutionAdapter) failPersistedAgent(_ *agentRun, id, code, summary string) (workflow.ExecutionResult, error) {
	return workflow.ExecutionResult{AgentRunID: id, Status: workflow.RunFailed, ErrorCode: code, ErrorSummary: summary}, errors.New(summary)
}

func workflowResultFromAgent(state agentrun.Run) workflow.ExecutionResult {
	result := workflow.ExecutionResult{AgentRunID: state.ID}
	switch state.Status {
	case agentrun.StatusDone:
		result.Status = workflow.RunSucceeded
		result.Output, _ = json.Marshal(state.Result)
	case agentrun.StatusCanceled:
		result.Status = workflow.RunInterrupted
		result.ErrorCode, result.ErrorSummary = "execution_interrupted", "agent execution was canceled"
	case agentrun.StatusError:
		if state.Error == "Server restarted before run completed" {
			result.Status = workflow.RunInterrupted
			result.ErrorCode, result.ErrorSummary = "execution_interrupted", "server restarted before run completed"
		} else {
			result.Status = workflow.RunFailed
			result.ErrorCode, result.ErrorSummary = "agent_execution_failed", "agent execution failed"
		}
	default:
		result.Status = workflow.RunInterrupted
		result.ErrorCode, result.ErrorSummary = "execution_interrupted", "agent execution is already owned"
	}
	return result
}

func isWorkflowInterrupted(ctx context.Context, err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || (ctx != nil && ctx.Err() != nil)
}

func (s *Server) prepareWorkflowAgentPlan(intent workflow.DispatchIntent) workflowAgentExecutionPlan {
	plan := workflowAgentExecutionPlan{
		request:  agentRunCreateReq{ExecutionMode: agentExecutionModeOffline, MaxIterations: workflowAgentDefaultIterations, Provider: &agentProviderConfig{ID: "local", Name: "Local Server", BaseURL: "http://localhost/v1"}},
		metadata: map[string]interface{}{"providerId": "local", "executionMode": string(workflow.ExecutionModeOffline), "maxIterations": workflowAgentDefaultIterations, "tools": []string{}},
	}
	var input workflowAgentPromptInput
	if len(intent.Input) == 0 || json.Unmarshal(intent.Input, &input) != nil {
		plan.policyCode, plan.policyReason = "invalid_input", "workflow agent input is invalid"
		return plan
	}
	if strings.TrimSpace(input.Type) != "" && strings.TrimSpace(input.Type) != workflow.StepTypeAgentPromptV1 {
		plan.policyCode, plan.policyReason = "invalid_input", "workflow agent input type is unsupported"
		return plan
	}
	plan.request.Goal = strings.TrimSpace(input.Prompt)
	plan.request.ModelName = strings.TrimSpace(input.ModelName)
	plan.request.SessionID = strings.TrimSpace(input.SessionID)
	if input.MaxIterations != nil {
		if *input.MaxIterations < 0 || *input.MaxIterations > 100 {
			plan.policyCode, plan.policyReason = "invalid_input", "maxIterations is outside the allowed range"
			return plan
		}
		if *input.MaxIterations > 0 {
			plan.request.MaxIterations = *input.MaxIterations
		}
	}
	mode, err := workflow.NormalizeExecutionMode(input.ExecutionMode)
	if err != nil {
		plan.policyCode, plan.policyReason = "invalid_input", "execution mode is invalid"
		return plan
	}
	plan.request.ExecutionMode = string(mode)
	plan.request.Provider = &agentProviderConfig{ID: "local", Name: "Local Server", BaseURL: "http://localhost/v1"}
	if strings.TrimSpace(input.ProviderID) != "" {
		plan.request.Provider.ID = strings.TrimSpace(input.ProviderID)
	}
	if plan.request.ModelName == "" && s.eng != nil {
		plan.request.ModelName = strings.TrimSpace(s.eng.GetModelName())
	}
	if plan.request.MaxIterations == 0 {
		plan.request.MaxIterations = workflowAgentDefaultIterations
	}
	plan.request.Tools, plan.policyReason = s.validateWorkflowTools(input.Tools, string(mode), intentOwner(intent, s))
	if plan.policyReason != "" {
		plan.policyCode = "policy_denied"
		return plan
	}
	toolNames := make([]string, 0, len(plan.request.Tools))
	for _, tool := range plan.request.Tools {
		toolNames = append(toolNames, tool.Function.Name)
	}
	plan.metadata = map[string]interface{}{"providerId": plan.request.Provider.ID, "executionMode": string(mode), "maxIterations": plan.request.MaxIterations, "tools": toolNames}

	if plan.request.Goal == "" || len(plan.request.Goal) > workflow.MaxPromptBytes {
		plan.policyCode, plan.policyReason = "invalid_input", "prompt must be a non-empty bounded string"
		return plan
	}
	if mode == workflow.ExecutionModeOffline {
		if plan.request.Provider.ID != "local" {
			plan.policyCode, plan.policyReason = "policy_denied", "offline execution requires the local provider"
			return plan
		}
		if s.eng == nil || !s.eng.IsModelLoaded() || plan.request.ModelName == "" || plan.request.ModelName != s.eng.GetModelName() {
			plan.policyCode, plan.policyReason = "policy_denied", "requested local model is unavailable"
			return plan
		}
	} else {
		if plan.request.Provider.ID == "local" {
			plan.policyCode, plan.policyReason = "policy_denied", "online execution requires an owned enabled provider"
			return plan
		}
		provider, providerErr := s.findProviderByID(intentOwner(intent, s), plan.request.Provider.ID)
		if providerErr != nil || provider == nil || !provider.Enabled || assertPublicURL(provider.BaseURL) != nil {
			plan.policyCode, plan.policyReason = "policy_denied", "owned enabled provider required"
			return plan
		}
		plan.request.Provider = &agentProviderConfig{ID: provider.ID, Name: provider.Name, BaseURL: provider.BaseURL}
		plan.metadata["providerId"] = provider.ID
	}
	return plan
}

func (s *Server) validateWorkflowTools(tools []agentToolDef, mode, owner string) ([]agentToolDef, string) {
	if len(tools) == 0 {
		return nil, ""
	}
	seen := make(map[string]struct{}, len(tools))
	validated := make([]agentToolDef, 0, len(tools))
	for _, tool := range tools {
		name := strings.TrimSpace(tool.Function.Name)
		if name == "" || (tool.Type != "" && tool.Type != "function") {
			return nil, "tool definition is malformed"
		}
		canonical, known := canonicalBackendAgentToolName(name)
		if known {
			name = canonical
		}
		if _, duplicate := seen[name]; duplicate {
			return nil, "duplicate tool definition"
		}
		seen[name] = struct{}{}
		if mode == agentExecutionModeOffline && isNetworkBoundAgentTool(name) {
			return nil, "network-bound tools are blocked in offline mode"
		}
		if !known && len(s.loadEnabledMcpServersForMode(mode, owner)) == 0 {
			return nil, "tool is not authorized by an enabled MCP server"
		}
		tool.Type = "function"
		tool.Function.Name = name
		validated = append(validated, tool)
	}
	return validated, ""
}

var _ workflow.ExecutionExecutor = (*workflowExecutionAdapter)(nil)
