import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle } from '../components/common/Icons';
import { useAuth } from '../context/AuthContext';
import AuthShell from '../components/common/AuthShell';
import { Button, Input, Select, Field } from '../components/common/ui';

export const Register = () => {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    branch: 'Computer Science & Engineering',
    semester: 1,
    targetAttendance: 75,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const branches = [
    'Computer Science & Engineering',
    'Information Science & Engineering',
    'Electronics & Communication Engineering',
    'Artificial Intelligence & Data Science',
    'Electrical & Electronics Engineering',
    'Mechanical Engineering',
    'Civil Engineering',
  ];

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register({
        ...formData,
        semester: Number(formData.semester),
        targetAttendance: Number(formData.targetAttendance),
      });
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create your Acadova account"
      subtitle="Start with a clean slate. Your data is yours alone."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent-strong hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="mb-5 p-3 rounded-md bg-danger-soft border border-danger/25 text-danger text-xs flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Full name">
          <Input
            type="text"
            required
            name="name"
            autoComplete="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Your name"
          />
        </Field>

        <Field label="Email">
          <Input
            type="email"
            required
            name="email"
            autoComplete="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="you@college.edu"
          />
        </Field>

        <Field label="Password" hint="At least 6 characters.">
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              required
              name="password"
              minLength={6}
              autoComplete="new-password"
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
              className="pr-16"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 px-3 text-2xs font-medium text-ink-400 hover:text-ink-600"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Current semester">
            <Select name="semester" value={formData.semester} onChange={handleChange}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Attendance target %">
            <Input
              type="number"
              name="targetAttendance"
              min="50"
              max="100"
              value={formData.targetAttendance}
              onChange={handleChange}
            />
          </Field>
        </div>

        <Field label="Branch">
          <Select name="branch" value={formData.branch} onChange={handleChange}>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </Field>

        <Button type="submit" disabled={loading} className="w-full !h-10">
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
};

export default Register;
