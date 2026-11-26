import { Badge } from "@/components/ui/badge";
import type { WorkflowRunStatus, WorkflowStepStatus } from "@/types/workflows";

type Status = WorkflowRunStatus | WorkflowStepStatus;

function labelForStatus(status: Status): string {
  return String(status || "unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function toneForStatus(status: Status): string {
  switch (status) {
    case "succeeded":
      return "border-status-online/30 bg-status-online/10 text-status-online";
    case "failed":
    case "interrupted":
    case "cancelled":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "running":
      return "border-primary/30 bg-primary/10 text-primary";
    case "blocked_policy":
      return "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

export default function WorkflowStatusBadge({ status }: { status: Status }) {
  return (
    <Badge variant="outline" className={`font-mono text-[10px] uppercase tracking-wide ${toneForStatus(status)}`}>
      {labelForStatus(status)}
    </Badge>
  );
}
