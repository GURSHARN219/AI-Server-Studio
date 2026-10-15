import React from "react";

// Shared UI primitives used across all settings tabs.

export const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <button
    onClick={() => onChange(!value)}
    className={`w-8 h-[18px] rounded-full relative transition-colors ${value ? "bg-primary" : "bg-muted"}`}
  >
    <div className={`w-3.5 h-3.5 rounded-full bg-primary-foreground absolute top-[2px] transition-all ${value ? "left-[16px]" : "left-[2px]"}`} />
  </button>
);

export const InputField = ({ label, value, onChange, mono, placeholder }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string }) => (
  <div className="flex items-center justify-between py-2">
    <span className="text-xs text-foreground">{label}</span>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`bg-surface-hover border border-border rounded px-2.5 py-1 text-xs text-foreground w-48 focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground ${mono ? "font-mono" : ""}`}
    />
  </div>
);

export const SelectField = ({ label, value, onChange, options, desc }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; desc?: string }) => (
  <div className="flex items-center justify-between py-2">
    <div>
      <span className="text-xs text-foreground">{label}</span>
      {desc && <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>}
    </div>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-surface-hover border border-border rounded px-2.5 py-1 text-xs text-foreground w-48 focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </div>
);

export const ToggleField = ({ label, desc, value, onChange, indent }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void; indent?: boolean }) => (
  <div className={`flex items-center justify-between py-2 ${indent ? "pl-4" : ""}`}>
    <div>
      <span className={`text-xs ${indent ? "text-muted-foreground" : "text-foreground"}`}>{indent ? `↳ ${label}` : label}</span>
      {desc && <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>}
    </div>
    <Toggle value={value} onChange={onChange} />
  </div>
);

export const SliderField = ({ label, value, onChange, min, max, step, reset }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; reset?: () => void }) => (
  <div className="flex items-center justify-between py-2">
    <span className="text-xs text-foreground">{label}</span>
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-36 cursor-pointer appearance-none h-1 rounded-full bg-border [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-muted-foreground [&::-webkit-slider-thumb]:cursor-pointer"
      />
      {reset && (
        <button onClick={reset} className="text-muted-foreground hover:text-foreground transition-colors" title="Reset">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        </button>
      )}
    </div>
  </div>
);

export const SegmentField = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) => (
  <div className="flex items-center justify-between py-2">
    <span className="text-xs text-foreground">{label}</span>
    <div className="flex rounded overflow-hidden border border-border">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1 text-xs transition-colors ${value === o.value ? "bg-muted text-foreground font-medium" : "bg-surface-hover text-muted-foreground hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  </div>
);

export const SectionHeader = ({ children }: { children: React.ReactNode }) => (
  <div className="pt-4 pb-1">
    <h3 className="text-xs font-semibold text-foreground">{children}</h3>
    <div className="border-t border-border/50 mt-2" />
  </div>
);
