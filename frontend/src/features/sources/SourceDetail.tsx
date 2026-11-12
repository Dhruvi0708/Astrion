import { useRef, useState, type FormEvent } from 'react';
import { Download, ExternalLink, FileText, Plus, Upload, X } from 'lucide-react';
import { Badge, PlannedBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { ErrorState, SkeletonRows } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api/client';
import { useCreateDocument, useDocuments, useUploadDocument } from '@/lib/api/hooks';
import type { Source } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import { TYPE_LABEL } from './SourceForm';

function DocumentForm({ sourceId, onDone }: { sourceId: string; onDone: () => void }) {
  const mutation = useCreateDocument(sourceId);
  const [title, setTitle] = useState('');
  const [mediaType, setMediaType] = useState('application/pdf');
  const [size, setSize] = useState('');
  const [hash, setHash] = useState('');
  const [touched, setTouched] = useState(false);
  const titleError = touched && !title.trim() ? 'Required.' : null;
  const hashError = hash && !/^[a-f0-9]{64}$/i.test(hash) ? 'Expected a 64-character SHA-256 hex digest.' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!title.trim() || hashError) return;
    try {
      await mutation.mutateAsync({
        title: title.trim(),
        media_type: mediaType.trim(),
        byte_size: size ? Number(size) : null,
        content_hash: hash ? hash.toLowerCase() : null,
      });
      onDone();
    } catch {
      /* shown below */
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-md border border-line bg-deep/60 p-3">
      <Field label="Document title" htmlFor="doc-title" required error={titleError}>
        <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={Boolean(titleError)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Media type" htmlFor="doc-mime">
          <Input id="doc-mime" value={mediaType} onChange={(e) => setMediaType(e.target.value)} />
        </Field>
        <Field label="Size (bytes)" htmlFor="doc-size">
          <Input id="doc-size" type="number" min={0} value={size} onChange={(e) => setSize(e.target.value)} />
        </Field>
      </div>
      <Field label="SHA-256" htmlFor="doc-hash" error={hashError} hint="Optional content hash for integrity.">
        <Input id="doc-hash" value={hash} onChange={(e) => setHash(e.target.value)} className="font-mono text-xs" aria-invalid={Boolean(hashError)} />
      </Field>
      {mutation.error && (
        <p role="alert" className="text-xs text-conflict">
          {mutation.error instanceof ApiError && mutation.error.isUnavailable ? 'Backend unreachable.' : mutation.error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" type="submit" variant="primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Add document'}
        </Button>
      </div>
    </form>
  );
}

const ACCEPT = '.pdf,.txt,.md,.csv,.json,.html,.docx,.xlsx';
const MAX_MB = 50;

function UploadButton({ sourceId }: { sourceId: string }) {
  const upload = useUploadDocument(sourceId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMessage(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setMessage(`That file is larger than ${MAX_MB} MB.`);
      return;
    }
    try {
      await upload.mutateAsync({ file });
    } catch (err) {
      setMessage(err instanceof ApiError ? (err.isUnavailable ? 'Backend unreachable — upload not saved.' : err.message) : 'Upload failed.');
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={onPick}
        aria-label="Upload a document file"
        data-testid="document-upload"
      />
      <Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
        <Upload size={13} /> {upload.isPending ? 'Uploading…' : 'Upload'}
      </Button>
      {message && (
        <p
          role="alert"
          className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-conflict/30 bg-surface px-2.5 py-1.5 text-2xs text-conflict shadow-panel"
        >
          {message}
        </p>
      )}
    </div>
  );
}

function DownloadButton({ documentId, fallbackName }: { documentId: string; fallbackName: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const download = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const { blob, filename } = await api.downloadDocument(documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? fallbackName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={download}
      disabled={busy}
      aria-label={`Download ${fallbackName}`}
      title={failed ? 'Download failed — try again' : 'Download'}
      className={`rounded p-1 ${failed ? 'text-conflict' : 'text-ink-faint hover:bg-raised hover:text-ink'}`}
    >
      <Download size={13} />
    </button>
  );
}

export function SourceDetail({ source, onClose }: { source: Source; onClose: () => void }) {
  const docs = useDocuments(source.id);
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="cyan">{TYPE_LABEL[source.source_type]}</Badge>
            <Badge tone="live">{source.status}</Badge>
          </div>
          <button onClick={onClose} aria-label="Close source details" className="-mr-1 -mt-1 rounded p-1 text-ink-faint hover:bg-raised hover:text-ink">
            <X size={14} />
          </button>
        </div>
        <h2 className="mt-3 font-display text-base font-medium leading-snug">{source.title}</h2>
        {source.description && <p className="mt-2 text-xs leading-relaxed text-ink-muted">{source.description}</p>}
        <dl className="mt-4 grid grid-cols-[88px_1fr] gap-y-1.5 text-xs">
          <dt className="text-ink-faint">Authors</dt>
          <dd className="text-ink-muted">{source.authors.length ? source.authors.join(', ') : '—'}</dd>
          <dt className="text-ink-faint">Published</dt>
          <dd className="text-ink-muted">{source.published_on ? formatDate(source.published_on) : '—'}</dd>
          <dt className="text-ink-faint">Citation</dt>
          <dd className="text-ink-muted">{source.citation ?? '—'}</dd>
          <dt className="text-ink-faint">Link</dt>
          <dd className="min-w-0">
            {source.uri ? (
              <a
                href={source.uri}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex max-w-full items-center gap-1 truncate text-cyan hover:underline"
              >
                <span className="truncate">{source.uri}</span> <ExternalLink size={11} className="shrink-0" />
              </a>
            ) : (
              <span className="text-ink-muted">—</span>
            )}
          </dd>
          <dt className="text-ink-faint">ID</dt>
          <dd className="truncate font-mono text-2xs text-ink-faint">{source.id}</dd>
        </dl>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <p className="eyebrow">Documents</p>
          <div className="flex items-center gap-1">
            <UploadButton sourceId={source.id} />
            {!adding && (
              <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                <Plus size={13} /> Metadata
              </Button>
            )}
          </div>
        </div>
        {adding && (
          <div className="mb-3">
            <DocumentForm sourceId={source.id} onDone={() => setAdding(false)} />
          </div>
        )}
        {docs.isLoading ? (
          <SkeletonRows rows={2} />
        ) : docs.isError ? (
          <ErrorState error={docs.error} onRetry={() => docs.refetch()} compact />
        ) : docs.data?.items.length ? (
          <ul className="space-y-1.5">
            {docs.data.items.map((d) => (
              <li key={d.id} className="flex items-start gap-2.5 rounded-md border border-line bg-deep/50 px-3 py-2">
                <FileText size={14} className="mt-0.5 shrink-0 text-ink-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8rem] text-ink">{d.title}</p>
                  <p className="text-2xs text-ink-faint">
                    {d.media_type}
                    {d.byte_size != null && ` · ${(d.byte_size / 1024).toFixed(1)} KB`} · {d.has_file ? 'stored' : 'metadata only'} · {d.processing_status}
                  </p>
                </div>
                {d.has_file && <DownloadButton documentId={d.id} fallbackName={d.original_filename ?? d.title} />}
              </li>
            ))}
          </ul>
        ) : (
          !adding && <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-ink-muted">No documents yet.</p>
        )}
        <div className="mt-4 flex items-start gap-2 rounded-md border border-dashed border-line-strong px-3 py-2.5 text-2xs leading-relaxed text-ink-faint">
          <PlannedBadge label="Planned" />
          <span>Parsing and claim extraction. Uploaded files are stored securely but not read yet — status stays “registered”.</span>
        </div>
      </div>
    </div>
  );
}
