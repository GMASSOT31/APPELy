import { useId, useState, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react'
import { AlertCircle, Check, CheckCircle2, Copy, Loader2 } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-strong',
  secondary: 'bg-white text-ink ring-1 ring-line hover:bg-surface',
  danger: 'bg-white text-danger-ink ring-1 ring-danger/40 hover:bg-danger/10',
  ghost: 'text-muted hover:bg-surface hover:text-ink',
}

export function Button({
  variant = 'primary',
  loading,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${variants[variant]} ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  error,
  ...input
}: ComponentProps<'input'> & { label: string; hint?: string; error?: string }) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-invalid={error ? true : undefined}
        {...input}
        className="min-h-11 rounded-xl border-0 bg-white px-3.5 text-base ring-1 ring-line placeholder:text-muted/60 focus:ring-2 focus:ring-primary focus:outline-none"
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  )
}

export function Card({ children, className = '', flush }: { children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <div className={`rounded-[var(--radius-card)] bg-white shadow-[var(--shadow-card)] ${flush ? 'overflow-hidden' : 'p-5'} ${className}`}>
      {children}
    </div>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <div role="alert" className="flex gap-2 rounded-xl bg-danger/10 p-3 text-sm text-danger-ink">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  )
}

export function SuccessBox({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex gap-2 rounded-xl bg-success/10 p-3 text-sm text-success-ink">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

const tones = {
  success: 'bg-success/12 text-success-ink',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-danger/12 text-danger-ink',
  info: 'bg-surface text-primary-strong',
  neutral: 'bg-canvas text-muted ring-1 ring-line',
}

export function Badge({ tone, children }: { tone: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

/** Lien à transmettre : affiché en entier et copiable en un clic. */
export function CopyLink({ url, label = 'Lien à transmettre' }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-2 text-xs ring-1 ring-line">{url}</code>
        <Button
          type="button"
          variant="secondary"
          className="shrink-0"
          onClick={async () => {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? 'Copié' : 'Copier'}
        </Button>
      </div>
      <p className="text-xs text-muted">Valable 72 heures, utilisable une seule fois. Transmettez-le uniquement à la personne concernée.</p>
    </div>
  )
}

export function Spinner() {
  return (
    <div className="grid min-h-[40vh] place-items-center" role="status" aria-label="Chargement">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
    </div>
  )
}
