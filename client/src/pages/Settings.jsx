import React, { useState } from 'react';
import { CheckCircle2 } from '../components/common/Icons';
import { useAuth } from '../context/AuthContext';
import API from '../services/api';
import { Button, Card, Field, Input, Select, SectionHeader, PageHeader, PageFrame, StateNote } from '../components/common/ui';
import NotificationSettings from './NotificationSettings';

export const Settings = () => {
  const { user, updateUser } = useAuth();

  const [form, setForm] = useState({
    name: user?.name || '',
    branch: user?.branch || 'Computer Science & Engineering',
    semester: user?.semester || 1,
    targetAttendance: user?.targetAttendance || 75,
    college: user?.college || '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const branches = [
    'Computer Science & Engineering',
    'Information Science & Engineering',
    'Electronics & Communication Engineering',
    'Artificial Intelligence & Data Science',
    'Electrical & Electronics Engineering',
    'Mechanical Engineering',
    'Civil Engineering',
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const res = await API.put('/auth/profile', form);
      if (res.data?.success) {
        updateUser(res.data.user);
        setMessage('Profile updated.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageFrame>
      <PageHeader
        meta="Account"
        title="Settings"
        description="Your profile, and the notifications you choose to receive."
      />

      {message && (
        <StateNote tone="success">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> {message}
          </span>
        </StateNote>
      )}
      {error && <StateNote tone="error">{error}</StateNote>}

      {/* Profile and Notifications sit side by side on desktop and start at the
          same vertical position; they stack in the same order on smaller screens. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <Card>
        <div className="p-5 sm:p-6">
          <SectionHeader title="Profile" description="Shown inside the app to personalise your workspace." />
          <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
            <Field label="Full name">
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>

            <Field label="Email">
              <Input value={user?.email || ''} disabled />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Current semester">
                <Select value={form.semester} onChange={(e) => setForm({ ...form, semester: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <option key={s} value={s}>Semester {s}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Attendance target %" hint="Used for warnings; each subject can override it.">
                <Input
                  type="number"
                  min="50"
                  max="100"
                  value={form.targetAttendance}
                  onChange={(e) => setForm({ ...form, targetAttendance: Number(e.target.value) })}
                />
              </Field>
            </div>

            <Field label="Branch">
              <Select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })}>
                {branches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </Select>
            </Field>

            <Field label="College / institute (optional)">
              <Input
                value={form.college}
                onChange={(e) => setForm({ ...form, college: e.target.value })}
                placeholder="Leave blank if you prefer"
              />
            </Field>

            <div className="pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </div>
      </Card>

      <NotificationSettings />
      </div>

      <Card>
        <div className="p-5 sm:p-6">
          <SectionHeader title="Legal" />
          <div className="flex gap-4 text-sm">
            <a href="/legal/terms" className="text-accent-strong hover:underline">Terms of Service</a>
            <a href="/legal/privacy" className="text-accent-strong hover:underline">Privacy Policy</a>
          </div>
          <p className="text-2xs text-ink-400 mt-3">
            Both documents are marked DRAFT FOR REVIEW until operational details (contact address,
            retention process) are confirmed.
          </p>
        </div>
      </Card>
    </PageFrame>
  );
};

export default Settings;
