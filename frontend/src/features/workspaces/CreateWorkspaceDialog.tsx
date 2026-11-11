import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Textarea } from '@/components/ui/Form';
import { ApiError } from '@/lib/api/client';
import { useCreateWorkspace } from '@/lib/api/hooks';
import { usePreferences, useUi } from '@/stores/ui';

/** Creates a real workspace through POST /api/v1/workspaces. */
export function CreateWorkspaceDialog() {
  const open = useUi((s) => s.createWorkspaceOpen);
  const setOpen = useUi((s) => s.setCreateWorkspaceOpen);
  const setActive = usePreferences((s) => s.setActiveWorkspaceId);
  const mutation = useCreateWorkspace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);

  const nameError = touched && !name.trim() ? 'A workspace name is required.' : null;

  const close = () => {
    setOpen(false);
    setTouched(false);
    mutation.reset();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim()) return;
    try {
      const ws = await mutation.mutateAsync({ name: name.trim(), description: description.trim() || null });
      setActive(ws.id);
      setName('');
      setDescription('');
      close();
    } catch {
      /* error rendered below */
    }
  };

  const err = mutation.error;
  return (
    <Dialog open={open} onClose={close} title="Create workspace" description="A workspace groups the sources, graph and investigations for one line of inquiry.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" htmlFor="ws-name" required error={nameError}>
          <Input id="ws-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={Boolean(nameError)} placeholder="e.g. Coastal resilience review" />
        </Field>
        <Field label="Description" htmlFor="ws-desc" hint="Optional. What question or domain does this workspace cover?">
          <Textarea id="ws-desc" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {err && (
          <p role="alert" className="rounded-md border border-conflict/30 bg-conflict/[0.06] px-3 py-2 text-xs text-conflict">
            {err instanceof ApiError && err.isUnavailable ? 'The backend is unreachable — start the API and try again.' : err.message}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create workspace'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
