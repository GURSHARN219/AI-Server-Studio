import EmbeddedGoClawApp from "@/goclaw/EmbeddedGoClawApp";

export default function ClawUiPage() {
  return (
    <div className="flex-1 min-w-0 min-h-0 overflow-hidden bg-background">
      <EmbeddedGoClawApp />
    </div>
  );
}
