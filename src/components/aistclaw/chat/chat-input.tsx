import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Send, Square, Paperclip, X } from "lucide-react";

export interface AttachedFile {
  file: File;
  /** Server path after upload, set during send */
  serverPath?: string;
}

interface ChatInputProps {
  onSend: (message: string, files?: AttachedFile[]) => void;
  onAbort: () => void;
  /** True when main agent or team tasks are active — controls stop button, file attach */
  isBusy: boolean;
  disabled?: boolean;
  placeholder?: string;
  helperText?: string;
  files: AttachedFile[];
  onFilesChange: (files: AttachedFile[]) => void;
}

export function ChatInput({ onSend, onAbort, isBusy, disabled, placeholder, helperText, files, onFilesChange }: ChatInputProps) {
  const { t } = useTranslation("common");
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    if ((!value.trim() && files.length === 0) || disabled) return;
    onSend(value, files.length > 0 ? files : undefined);
    setValue("");
    onFilesChange([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, files, onSend, onFilesChange, disabled]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;
    const newFiles: AttachedFile[] = Array.from(selected).map((f) => ({ file: f }));
    onFilesChange([...files, ...newFiles]);
    e.target.value = "";
  }, [files, onFilesChange]);

  const removeFile = useCallback((index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  }, [files, onFilesChange]);

  const hasContent = value.trim().length > 0 || files.length > 0;

  return (
    <div
      className="mx-auto w-full max-w-3xl px-4 py-2 mb-8 safe-bottom shrink-0"
      style={{ paddingBottom: `calc(env(safe-area-inset-bottom) + var(--keyboard-height, 0px))` }}
    >
      {/* Attached files preview */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {files.map((af, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 backdrop-blur-md px-3 py-1.5 text-xs font-medium shadow-sm border border-border/50"
            >
              <span className="max-w-[150px] truncate">{af.file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="rounded-full p-0.5 hover:bg-background/80 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Input container — attach + textarea + send/stop inside one rounded box */}
      <div
        className={`flex items-end rounded-[1.75rem] border backdrop-blur-xl shadow-lg transition-all focus-within:shadow-xl focus-within:ring-2 focus-within:ring-primary/20 ${disabled ? "border-border/80 bg-muted/25" : "bg-background/80 border-border/50"
          }`}
      >
        {/* Attach button inside input */}
        <button
          type="button"
          onClick={handleFileSelect}
          disabled={disabled || isBusy}
          title={t("attachFile")}
          className="shrink-0 p-3.5 pl-4 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 cursor-pointer"
        >
          <Paperclip className="h-5 w-5" />
        </button>

        {/* Textarea — no border, transparent bg */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={placeholder ?? t("sendMessage")}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent py-4 px-1 text-[15px] placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 min-h-[52px] max-h-[200px]"
        />

        {/* Send / Stop buttons */}
        <div className="shrink-0 p-2 pr-2.5 flex items-center gap-1">
          {isBusy ? (
            <>
              <button
                type="button"
                onClick={handleSend}
                disabled={!value.trim() || disabled}
                title={t("sendFollowUp")}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-transform active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Send className="h-4 w-4 ml-0.5" />
              </button>
              <button
                type="button"
                onClick={onAbort}
                title={t("stopGeneration")}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-transform active:scale-95"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!hasContent || disabled}
              title={t("sendMessageTitle")}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-transform active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4 ml-0.5" />
            </button>
          )}
        </div>
      </div>

      {helperText && <p className="mt-2 px-4 text-[11px] text-muted-foreground/70">{helperText}</p>}
    </div>
  );
}
