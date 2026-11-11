import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { ApiError } from '@/lib/api/client';
import { useCreateSource } from '@/lib/api/hooks';
import { SOURCE_TYPES, type Source, type SourceType } from '@/lib/api/types';

const TYPE_LABEL: Record<SourceType, string> = {
  paper: 'Research paper',
  report: 'Report',
  dataset: 'Dataset',
  article: 'Article',
  document: 'Document',
  web: 'Web page',
  other: 'Other',
};

/** Field-level messages from a FastAPI 422 response, keyed by field name. */
function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.status !== 422 || !Array.isArray(error.details)) return {};
  const out: Record<string, string> = {};
  for (const d of error.details as { loc?: unknown[]; msg?: string }[]) {
    const field = d.loc?.[d.loc.length - 1];
    if (typeof field === 'string' && d.msg) out[field] = d.msg;
  }
  return out;
}

export function SourceForm({ workspaceId, onCreated, onCancel }: { workspaceId: string; onCreated: (s: Source) => void; onCancel: () => void }) {
  const mutation = useCreateSource(workspaceId);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<SourceType>('paper');
  const [uri, setUri] = useState('');
  const [authors, setAuthors] = useState('');
  const [published, setPublished] = useState('');
  const [citation, setCitation] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);

  const server = fieldErrors(mutation.error);
  const titleError = touched && !title.trim() ? 'A title is required.' : server.title ?? null;
  const uriError = uri && !/^https?:\/\/\S+$/i.test(uri) ? 'Use a full http(s) URL.' : server.uri ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!title.trim() || uriError) return;
    try {
      const created = await mutation.mutateAsync({
        title: title.trim(),
        source_type: type,
        uri: uri.trim() || null,
        citation: citation.trim() || null,
        authors: authors
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        published_on: published || null,
        description: description.trim() || null,
      });
      onCreated(created);
    } catch {
      /* rendered below */
    }
  };

  const generic = mutation.error && !Object.keys(server).length ? mutation.error : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Title" htmlFor="src-title" required error={titleError}>
        <Input id="src-title" value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={Boolean(titleError)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="src-type">
          <Select id="src-type" value={type} onChange={(e) => setType(e.target.value as SourceType)}>
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Published" htmlFor="src-date" error={server.published_on}>
          <Input id="src-date" type="date" value={published} onChange={(e) => setPublished(e.target.value)} />
        </Field>
      </div>
      <Field label="URL" htmlFor="src-uri" error={uriError} hint="Optional link to the original.">
        <Input id="src-uri" type="url" value={uri} onChange={(e) => setUri(e.target.value)} placeholder="https://" aria-invalid={Boolean(uriError)} />
      </Field>
      <Field label="Authors" htmlFor="src-authors" hint="Comma-separated.">
        <Input id="src-authors" value={authors} onChange={(e) => setAuthors(e.target.value)} />
      </Field>
      <Field label="Citation" htmlFor="src-citation" hint="Optional formatted citation.">
        <Input id="src-citation" value={citation} maxLength={2000} onChange={(e) => setCitation(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="src-desc">
        <Textarea id="src-desc" value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {generic && (
        <p role="alert" className="rounded-md border border-conflict/30 bg-conflict/[0.06] px-3 py-2 text-xs text-conflict">
          {generic instanceof ApiError && generic.isUnavailable ? 'The backend is unreachable — start the API and try again.' : generic.message}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Registering…' : 'Register source'}
        </Button>
      </div>
    </form>
  );
}

export { TYPE_LABEL };
