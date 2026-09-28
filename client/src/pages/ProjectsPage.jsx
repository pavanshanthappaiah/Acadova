import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderGit2, Plus, Trash2, ExternalLink, Clock, AlertCircle, Github,
  X, MoreHorizontal, Filter, Pencil,
} from '../components/common/Icons';
import API from '../services/api';
import {
  Button, Card, Field, Input, Select, Textarea, Badge, Modal, ConfirmDialog, EmptyState,
  ProgressBar, Checkbox, PageHeader, PageFrame, StateNote, Skeleton,
} from '../components/common/ui';
import { Reveal, AnimatedValue } from '../components/common/motion';

// Errors are shown where the action happened, never via alert().
const ErrorNote = ({ children }) => <StateNote tone="error">{children}</StateNote>;

const TECH_CATEGORIES = ['frontend', 'backend', 'database', 'tools'];

/* Status is a closed set, so it is labelled and toned in one place. The old
   `status.replace('_', ' ')` left "in progress" / "on hold" lowercase and only
   ever replaced the first underscore. */
const PROJECT_STATUS = {
  in_progress: { label: 'In progress', tone: 'accent' },
  completed: { label: 'Completed', tone: 'ok' },
  on_hold: { label: 'On hold', tone: 'warn' },
};
const statusMeta = (status) => PROJECT_STATUS[status] || { label: 'No status', tone: 'neutral' };

/** Technologies for a project, from either storage shape, with no duplicates. */
const projectTech = (proj) => {
  const flat = proj.technologies
    ? TECH_CATEGORIES.flatMap((cat) => proj.technologies[cat] || [])
    : (proj.techStack || []);
  return [...new Set(flat)];
};

const mediumDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export const ProjectsPage = () => {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [projectOpen, setProjectOpen] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [projectForm, setProjectForm] = useState({
    title: '', goal: '', githubUrl: '', liveDemoUrl: '', deadline: '',
  });

  // Repository Analyzer state
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null); // { techStack, repoMeta }
  const [selectedStack, setSelectedStack] = useState({ frontend: [], backend: [], database: [], tools: [] });
  const [customTech, setCustomTech] = useState({ frontend: '', backend: '', database: '', tools: '' });

  const [confirm, setConfirm] = useState(null); // { id, title, body, confirmLabel }
  const [hoursTarget, setHoursTarget] = useState(null);
  const [hoursValue, setHoursValue] = useState('1');
  const [hoursNote, setHoursNote] = useState('');
  const [hoursError, setHoursError] = useState('');
  // The manage-hours view: the project's dated entries, plus the entry being
  // edited ({ logId, hours, date, note }) or null when just viewing.
  const [hoursManage, setHoursManage] = useState(null); // project
  const [hoursLogs, setHoursLogs] = useState([]);
  const [hoursLogsLoading, setHoursLogsLoading] = useState(false);
  const [hoursForm, setHoursForm] = useState(null);
  const [hoursFormError, setHoursFormError] = useState('');

  const [milestoneTarget, setMilestoneTarget] = useState(null);
  const [milestoneName, setMilestoneName] = useState('');
  const [milestoneError, setMilestoneError] = useState('');

  // Search + filters operate on the loaded, owner-scoped project list.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [techFilter, setTechFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [menuFor, setMenuFor] = useState(null); // overflow menu (project id)
  const [menuUp, setMenuUp] = useState(false); // open the menu above its button
  const menuWrapRef = useRef(null); // wrapper element of the OPEN overflow menu

  // Overflow menu closes on outside tap or Esc, like every other popover in the app.
  useEffect(() => {
    if (!menuFor) return undefined;
    const onDown = (e) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target)) setMenuFor(null);
    };
    const onKey = (e) => e.key === 'Escape' && setMenuFor(null);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/technical/overview');
      if (res.data?.success) {
        setOverview(res.data);
        setLoadError('');
      } else {
        setLoadError('The server returned an unexpected response.');
      }
    } catch (err) {
      setLoadError(err.response?.data?.message || 'Could not load your projects. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const projects = overview?.projects || [];

  // Technology filter values derive ONLY from the student's real projects.
  const allTechnologies = useMemo(() => {
    const set = new Set();
    for (const proj of projects) {
      if (proj.technologies) {
        for (const cat of TECH_CATEGORIES) {
          for (const t of proj.technologies[cat] || []) set.add(t);
        }
      }
      for (const t of proj.techStack || []) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [projects]);

  const projectHasTech = (proj, tech) => {
    if (proj.technologies) return TECH_CATEGORIES.some((cat) => (proj.technologies[cat] || []).includes(tech));
    return (proj.techStack || []).includes(tech);
  };

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((proj) => {
      if (statusFilter !== 'all' && proj.status !== statusFilter) return false;
      if (techFilter !== 'all' && !projectHasTech(proj, techFilter)) return false;
      if (q && !(`${proj.title} ${proj.goal || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, search, statusFilter, techFilter]);

  const summary = useMemo(() => ({
    total: projects.length,
    completed: projects.filter((p) => p.status === 'completed').length,
    inProgress: projects.filter((p) => p.status === 'in_progress').length,
    hours: Math.round(projects.reduce((acc, p) => acc + (p.totalHoursSpent || 0), 0) * 10) / 10,
  }), [projects]);

  const selected = filteredProjects.find((p) => p._id === selectedId) || null;

  /* ------------------------------- mutations ------------------------------- */
  const resetProjectModal = () => {
    setProjectForm({ title: '', goal: '', githubUrl: '', liveDemoUrl: '', deadline: '' });
    setProjectError('');
    setAnalyzeLoading(false);
    setAnalyzeError('');
    setAnalysisResult(null);
    setSelectedStack({ frontend: [], backend: [], database: [], tools: [] });
    setCustomTech({ frontend: '', backend: '', database: '', tools: '' });
  };

  const analyzeRepository = async () => {
    const url = projectForm.githubUrl.trim();
    if (!url) {
      setAnalyzeError('Enter a GitHub URL first.');
      return;
    }
    setAnalyzeLoading(true);
    setAnalyzeError('');
    setAnalysisResult(null);
    setSelectedStack({ frontend: [], backend: [], database: [], tools: [] });
    try {
      const res = await API.post('/technical/projects/analyze-repo', { githubUrl: url });
      if (res.data?.success) {
        setAnalysisResult(res.data);
        const mapAcc = (arr) => (arr || []).map((t) => ({ ...t, accepted: true }));
        setSelectedStack({
          frontend: mapAcc(res.data.techStack?.frontend),
          backend: mapAcc(res.data.techStack?.backend),
          database: mapAcc(res.data.techStack?.database),
          tools: mapAcc(res.data.techStack?.tools),
        });
        if (!projectForm.title && res.data.repoMeta?.name) {
          setProjectForm((f) => ({ ...f, title: res.data.repoMeta.name }));
        }
      } else {
        setAnalyzeError(res.data?.message || 'Analysis failed.');
      }
    } catch (err) {
      setAnalyzeError(err.response?.data?.message || 'Could not analyze repository.');
    } finally {
      setAnalyzeLoading(false);
    }
  };

  const createProject = async (e) => {
    e.preventDefault();
    setProjectError('');
    const getAcc = (arr) => arr.filter((t) => t.accepted).map((t) => t.name);
    const technologies = {
      frontend: getAcc(selectedStack.frontend),
      backend: getAcc(selectedStack.backend),
      database: getAcc(selectedStack.database),
      tools: getAcc(selectedStack.tools),
    };
    try {
      await API.post('/technical/projects', { ...projectForm, technologies });
      setProjectOpen(false);
      resetProjectModal();
      await fetchOverview();
    } catch (err) {
      setProjectError(err.response?.data?.message || 'Could not create the project.');
    }
  };

  const toggleMilestone = async (projectId, milestoneIndex) => {
    try {
      await API.patch(`/technical/projects/${projectId}/milestone`, { milestoneIndex });
      await fetchOverview();
    } catch (err) {
      setLoadError(err.response?.data?.message || 'Could not update that milestone.');
    }
  };

  const submitMilestone = async (e) => {
    e.preventDefault();
    setMilestoneError('');
    if (!milestoneName.trim()) {
      setMilestoneError('Milestone name is required.');
      return;
    }
    try {
      await API.post(`/technical/projects/${milestoneTarget._id}/milestone`, { name: milestoneName.trim() });
      setMilestoneTarget(null);
      setMilestoneName('');
      await fetchOverview();
    } catch (err) {
      setMilestoneError(err.response?.data?.message || 'Could not add milestone.');
    }
  };

  const openLogHours = (project) => {
    setHoursTarget(project);
    setHoursValue('1');
    setHoursNote('');
    setHoursError('');
    setMenuFor(null);
  };

  const submitHours = async (e) => {
    e.preventDefault();
    setHoursError('');
    const hours = Number(hoursValue);
    if (!hours || hours <= 0) {
      setHoursError('Enter a number of hours greater than zero.');
      return;
    }
    try {
      await API.patch(`/technical/projects/${hoursTarget._id}/hours`, { hours, note: hoursNote.trim() });
      setHoursTarget(null);
      setHoursValue('1');
      setHoursNote('');
      await fetchOverview();
    } catch (err) {
      setHoursError(err.response?.data?.message || 'Could not log hours.');
    }
  };

  // Every dated entry for one project, newest first. The manage view opens
  // from the project's "Hours logged" figure and from "Log hours" flows.
  const loadHoursLogs = async (project) => {
    setHoursManage(project);
    setHoursLogsLoading(true);
    setHoursForm(null);
    setHoursFormError('');
    try {
      const res = await API.get(`/technical/projects/${project._id}/hours`);
      if (res.data?.success) setHoursLogs(res.data.logs || []);
    } catch {
      setHoursLogs([]);
    } finally {
      setHoursLogsLoading(false);
    }
  };

  const openEditHours = (entry) => {
    setHoursForm({ logId: entry.id, hours: String(entry.hours), date: entry.date, note: entry.note || '' });
    setHoursFormError('');
  };

  const submitEditHours = async (e) => {
    e.preventDefault();
    setHoursFormError('');
    const hours = Number(hoursForm.hours);
    if (!hours || hours <= 0 || hours > 24) {
      setHoursFormError('Hours must be greater than zero (max 24 per entry).');
      return;
    }
    try {
      await API.put(`/technical/projects/${hoursManage._id}/hours/${hoursForm.logId}`, {
        hours,
        date: hoursForm.date,
        note: hoursForm.note.trim(),
      });
      await loadHoursLogs(hoursManage);
      await fetchOverview();
    } catch (err) {
      setHoursFormError(err.response?.data?.message || 'Could not update that entry.');
    }
  };

  const deleteHoursEntry = async (entry) => {
    setHoursFormError('');
    try {
      await API.delete(`/technical/projects/${hoursManage._id}/hours/${entry.id}`);
      await loadHoursLogs(hoursManage);
      await fetchOverview();
    } catch (err) {
      setHoursFormError(err.response?.data?.message || 'Could not delete that entry.');
    }
  };

  const runDelete = async () => {
    if (!confirm) return;
    // A confirm payload with an `index` removes one progress point; without
    // one it deletes the whole project.
    if (typeof confirm.index === 'number') {
      try {
        await API.delete(`/technical/projects/${confirm.id}/milestone/${confirm.index}`);
        setConfirm(null);
        await fetchOverview();
      } catch (err) {
        setConfirm(null);
        setLoadError(err.response?.data?.message || 'Could not remove that progress point.');
      }
      return;
    }
    try {
      await API.delete(`/technical/projects/${confirm.id}`);
      setConfirm(null);
      if (selectedId === confirm.id) setSelectedId(null);
      await fetchOverview();
    } catch (err) {
      setConfirm(null);
      setLoadError(err.response?.data?.message || 'Could not delete that project.');
    }
  };

  // Real derived figures for the summary, computed only from loaded projects.
  const totals = useMemo(() => {
    const allMilestones = projects.flatMap((p) => p.milestones || []);
    const doneMilestones = allMilestones.filter((m) => m.completed).length;
    const averageProgress = projects.length
      ? Math.round(projects.reduce((acc, p) => acc + (Number(p.progress) || 0), 0) / projects.length)
      : 0;
    return { milestones: allMilestones.length, doneMilestones, averageProgress };
  }, [projects]);

  return (
    <PageFrame>
      <PageHeader
        meta="Growth"
        title="Projects"
        description="Track what you build, monitor progress, and organize your development work."
        hint="Each project keeps its own goal, tech stack, milestones and logged hours. Progress is the share of completed milestones."
        actions={
          <Button onClick={() => { setProjectError(''); setProjectOpen(true); }}>
            <Plus className="h-4 w-4" /> New project
          </Button>
        }
      />

      {loadError && (
        <StateNote
          tone="error"
          title={loadError}
          action={
            <button type="button" onClick={fetchOverview} className="text-xs font-medium underline underline-offset-2 hover:no-underline">
              Try again
            </button>
          }
        />
      )}

      {/* --------------------------- summary (real data) --------------------------- */}
      <Reveal>
        {loading && !overview ? (
          <Card className="overflow-hidden">
            <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="p-5 sm:p-6">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-4 h-12 w-32" />
                <Skeleton className="mt-4 h-3 w-44" />
              </div>
              <div className="border-t border-line bg-surface-muted p-5 sm:p-6 lg:border-l lg:border-t-0">
                <div className="grid grid-cols-3 gap-4 lg:grid-cols-1 lg:gap-6">
                  {[0, 1, 2].map((i) => (
                    <div key={i}>
                      <Skeleton className="h-2.5 w-20" />
                      <Skeleton className="mt-2.5 h-5 w-12" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        ) : (
          /* One primary figure carries the collection; the supporting figures
             sit on a quieter surface beside it. Not four identical cards. */
          <Card className="overflow-hidden">
            <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="p-5 sm:p-6">
                <p className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">
                  Projects
                </p>
                <p className="mt-2.5 flex items-baseline gap-2">
                  <AnimatedValue
                    value={summary.total}
                    className="font-display text-[3rem] font-semibold leading-none tracking-tightest text-ink-900"
                  />
                  <span className="text-sm font-medium text-ink-500">
                    {summary.total === 1 ? 'project' : 'projects'} tracked
                  </span>
                </p>
                <p className="mt-3 text-sm text-ink-500">
                  {summary.completed} completed, {summary.inProgress} in progress
                  {projects.length - summary.completed - summary.inProgress > 0 && (
                    <>, {projects.length - summary.completed - summary.inProgress} on hold</>
                  )}
                </p>
              </div>

              <div className="border-t border-line bg-surface-muted p-5 sm:p-6 lg:border-l lg:border-t-0">
                <dl className="grid grid-cols-3 gap-5 lg:grid-cols-1 lg:gap-6">
                  <div>
                    <dt className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">
                      Hours logged
                    </dt>
                    <dd className="mt-1.5 font-display text-xl font-semibold leading-none text-ink-900">
                      <AnimatedValue value={summary.hours} format={(v) => (Math.round(v * 10) / 10).toString()} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">
                      Tasks completed
                    </dt>
                    <dd className="mt-1.5 font-display text-xl font-semibold leading-none text-ink-900">
                      {totals.milestones > 0 ? (
                        <>
                          {/* The space is a real character, not only a margin, so the
                              phrase reads as "0 of 8" in text and to a screen reader. */}
                          <AnimatedValue value={totals.doneMilestones} />{' '}
                          <span className="text-xs font-medium text-ink-500">of {totals.milestones}</span>
                        </>
                      ) : (
                        <span className="text-sm font-medium text-ink-400">None yet</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">
                      Average progress
                    </dt>
                    <dd className="mt-1.5 font-display text-xl font-semibold leading-none text-ink-900">
                      {projects.length > 0 ? `${totals.averageProgress}%` : <span className="text-sm font-medium text-ink-400">None yet</span>}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </Card>
        )}
      </Reveal>

      {/* ----------------------------- search + filters ----------------------------- */}
      {/* Same toolbar pattern as the Problems filter bar, so filtering behaves
          and looks identical across Growth. */}
      {projects.length > 0 && (
        <Reveal>
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-line bg-surface-muted px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects"
                    aria-label="Search projects"
                    className="h-8 w-full min-w-0 py-0 text-xs sm:w-56"
                  />
                </div>
                <label className="flex items-center gap-2">
                  <span className="text-2xs font-semibold uppercase tracking-wide2 text-ink-400">
                    Status
                  </span>
                  <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    aria-label="Filter by status"
                    className="h-8 w-[8.5rem] rounded-md py-0 text-xs"
                  >
                    <option value="all">All</option>
                    <option value="in_progress">In progress</option>
                    <option value="completed">Completed</option>
                    <option value="on_hold">On hold</option>
                  </Select>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-2xs font-semibold uppercase tracking-wide2 text-ink-400">
                    Technology
                  </span>
                  <Select
                    value={techFilter}
                    onChange={(e) => setTechFilter(e.target.value)}
                    aria-label="Filter by technology"
                    className="h-8 w-[9.5rem] rounded-md py-0 text-xs"
                  >
                    <option value="all">All</option>
                    {allTechnologies.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </Select>
                </label>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <p className="text-xs text-ink-500">
                  Showing <span className="font-medium text-ink-900">{filteredProjects.length}</span> of{' '}
                  {projects.length}
                </p>
                {(search || statusFilter !== 'all' || techFilter !== 'all') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setSearch(''); setStatusFilter('all'); setTechFilter('all'); }}
                  >
                    <X className="h-3.5 w-3.5" /> Clear
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </Reveal>
      )}

      {/* ------------------------------- project grid ------------------------------- */}
      {loading && !overview ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-5">
              <div className="h-4 w-40 rounded bg-paper-deep animate-pulse" />
              <div className="h-3 w-full rounded bg-paper-deep animate-pulse mt-3" />
              <div className="h-1.5 w-full rounded bg-paper-deep animate-pulse mt-6" />
            </Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={FolderGit2}
            title="No projects yet"
            description="Add an engineering project with its goal and repository. Track milestones and log hours as you build."
            action={
              <Button onClick={() => { setProjectError(''); setProjectOpen(true); }}>
                <Plus className="w-4 h-4" /> Create your first project
              </Button>
            }
          />
        </Card>
      ) : filteredProjects.length === 0 ? (
        <Card>
          <EmptyState
            icon={FolderGit2}
            title="No projects match those filters"
            description="Adjust the search, status or technology filter to see your other projects."
          />
        </Card>
      ) : (
        /* auto-rows-fr makes every row exactly as tall as the tallest one, so
           the whole grid is a single size rather than only matching within a
           row. Combined with the stretching wrapper below, no card can end up
           shorter than its neighbours. */
        <div className="grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredProjects.map((proj) => {
            const isSelected = proj._id === selectedId;
            const milestones = proj.milestones || [];
            const completedCount = milestones.filter((m) => m.completed).length;
            // The wrapper exists only to anchor the overflow menu. It is a flex
            // container so the card below stretches to the full height of its
            // grid cell, making every card in a row exactly as tall as its
            // tallest neighbour.
            return (
              <div
                key={proj._id}
                className="flex"
                ref={(el) => {
                  if (menuFor === proj._id) menuWrapRef.current = el;
                }}
              >
              <Card
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${proj.title}, ${statusMeta(proj.status).label}. ${isSelected ? 'Hide details' : 'Show details'}`}
                className={`lift relative flex h-full w-full min-w-0 cursor-pointer flex-col p-5 ${
                  isSelected ? 'border-accent bg-accent-soft/25' : ''
                }`}
                onClick={() => setSelectedId(isSelected ? null : proj._id)}
                onKeyDown={(e) => {
                  // Cards are selectable surfaces containing their own controls,
                  // so they take role=button and handle Enter and Space directly
                  // rather than nesting buttons inside a <button>.
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(isSelected ? null : proj._id);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span aria-hidden="true" className="mt-0.5 shrink-0 rounded-md bg-accent-soft p-2 text-accent">
                      <FolderGit2 className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold leading-snug tracking-tightest text-ink-900 break-words">
                        {proj.title}
                      </h3>
                      {proj.goal && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-500">{proj.goal}</p>}
                    </div>
                  </div>
                  <div className="relative flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      aria-label={`Actions for ${proj.title}`}
                      aria-expanded={menuFor === proj._id}
                      aria-haspopup="menu"
                      onClick={(e) => {
                        // Flip the menu above its button when there is no room
                        // below: cards in the bottom row sit near the viewport
                        // edge, where a downward menu paints off-screen. The
                        // menu is roughly 140px tall with all four actions.
                        if (menuFor !== proj._id) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setMenuUp(window.innerHeight - rect.bottom < 150);
                        }
                        setMenuFor(menuFor === proj._id ? null : proj._id);
                      }}
                      className="pressable rounded p-1.5 text-ink-400 hover:bg-paper-deep hover:text-ink-900"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {menuFor === proj._id && (
                      /* Anchored to the ellipsis button (this wrapper is its
                         positioning parent), flipped above the button when the
                         viewport has no room below it. */
                      <div
                        className={`animate-pop-in absolute right-0 z-20 w-44 rounded-md border border-line bg-surface py-1 text-xs shadow-lift ${
                          menuUp ? 'bottom-full mb-1' : 'top-full mt-1'
                        }`}
                        role="menu"
                        onClick={(e) => e.stopPropagation()}
                      >
                    {proj.githubUrl && (
                      <a
                        href={proj.githubUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 px-3 py-2 text-ink-700 hover:bg-paper-deep"
                        role="menuitem"
                      >
                        <Github className="h-3.5 w-3.5" /> View on GitHub
                      </a>
                    )}
                    {proj.liveDemoUrl && (
                      <a
                        href={proj.liveDemoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 px-3 py-2 text-ink-700 hover:bg-paper-deep"
                        role="menuitem"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Open live demo
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => openLogHours(proj)}
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-ink-700 hover:bg-paper-deep"
                    >
                      <Clock className="h-3.5 w-3.5" /> Log hours
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirm({
                          id: proj._id,
                          title: `Delete “${proj.title}”?`,
                          body: 'This removes the project, its milestones and its logged hours.',
                          confirmLabel: 'Delete project',
                        });
                        setMenuFor(null);
                      }}
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-danger hover:bg-danger-soft"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete project
                    </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Badge tone={statusMeta(proj.status).tone}>{statusMeta(proj.status).label}</Badge>
                  {proj.deadline && (
                    <span className="text-2xs text-ink-400">Target {mediumDate(proj.deadline)}</span>
                  )}
                </div>

                {/* Real technologies only; never fabricated tags. */}
                {/* Real technologies only, rendered through the shared chip
                    system rather than a second hand-rolled chip. */}
                <div className="mt-3 min-h-[22px]">
                  {(() => {
                    const flat = projectTech(proj);
                    if (flat.length === 0) {
                      return <span className="text-2xs text-ink-400">No technologies added.</span>;
                    }
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {flat.slice(0, 6).map((t) => (
                          <Badge key={t} tone="quiet">{t}</Badge>
                        ))}
                        {flat.length > 6 && (
                          <span className="self-center text-2xs text-ink-400">
                            +{flat.length - 6} more
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* mt-auto absorbs any leftover height, so progress and the
                    footer sit on the same line across every card in a row
                    regardless of how much text the card above holds. */}
                <div className="mt-auto pt-4">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-2xs text-ink-500">
                    <span>Progress</span>
                    {/* The figure is stated in words beside the bar, so the bar
                        itself is never the only carrier of the value. */}
                    <span className="tabular-nums">
                      {proj.progress}%{milestones.length > 0 && `, ${completedCount} of ${milestones.length} tasks`}
                    </span>
                  </div>
                  <ProgressBar
                    value={proj.progress}
                    tone={proj.progress >= 100 ? 'ok' : 'accent'}
                    label={`${proj.title} progress`}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
                  <span className="text-2xs text-ink-500">
                    <span className="tabular-nums">{proj.totalHoursSpent || 0}</span> hours logged
                  </span>
                  <span className="text-2xs text-ink-400">Updated {mediumDate(proj.updatedAt)}</span>
                </div>
              </Card>
              </div>
            );
          })}
        </div>
      )}

      {/* --------------------------- selected project detail --------------------------- */}
      {selected && (
        <Reveal>
        <Card className="overflow-hidden border-accent-soft">
          {/* Workspace header: identity and actions on one line. */}
          <div className="flex flex-col gap-4 px-5 pb-5 pt-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden="true" className="shrink-0 rounded-lg bg-accent-soft p-2.5 text-accent">
                <FolderGit2 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-xl font-semibold tracking-tightest text-ink-900">
                    {selected.title}
                  </h2>
                  <Badge tone={statusMeta(selected.status).tone}>{statusMeta(selected.status).label}</Badge>
                </div>
                {selected.goal ? (
                  <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-500 whitespace-pre-line">
                    {selected.goal}
                  </p>
                ) : (
                  <p className="mt-1.5 text-sm text-ink-400">No project description added.</p>
                )}
                {projectTech(selected).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {projectTech(selected).map((t) => (
                      <Badge key={t} tone="quiet">{t}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {selected.githubUrl && (
                <a
                  href={selected.githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="pressable inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-surface px-3 text-xs font-medium text-ink-700 hover:border-ink-300 hover:bg-paper-deep hover:text-ink-900"
                >
                  <Github className="h-3.5 w-3.5" /> GitHub
                </a>
              )}
              {selected.liveDemoUrl && (
                <a
                  href={selected.liveDemoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="pressable inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-surface px-3 text-xs font-medium text-ink-700 hover:border-ink-300 hover:bg-paper-deep hover:text-ink-900"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Live demo
                </a>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { setHoursTarget(selected); setHoursValue('1'); setHoursError(''); }}
              >
                <Clock className="h-3.5 w-3.5" /> Log hours
              </Button>
            </div>
          </div>

          {/* Facts strip: the three figures that describe this project. */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line bg-surface-muted px-5 py-4 sm:grid-cols-4 sm:px-6">
            <div>
              <dt className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">Progress</dt>
              <dd className="mt-1 font-display text-lg font-semibold leading-none text-ink-900">
                <span className="tabular-nums">{selected.progress}%</span>
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">Tasks</dt>
              <dd className="mt-1 font-display text-lg font-semibold leading-none text-ink-900">
                {selected.milestones?.length ? (
                  <span className="tabular-nums">
                    {selected.milestones.filter((m) => m.completed).length} of {selected.milestones.length}
                  </span>
                ) : (
                  <span className="text-sm font-medium text-ink-400">None yet</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">Hours logged</dt>
              <dd className="mt-1">
                <button
                  type="button"
                  onClick={() => loadHoursLogs(selected)}
                  title="View and edit logged hours"
                  className="font-display text-lg font-semibold leading-none text-ink-900 underline decoration-line-strong underline-offset-4 hover:text-accent-strong"
                >
                  <span className="tabular-nums">{selected.totalHoursSpent || 0}</span>
                </button>
                <p className="mt-1 text-2xs text-ink-400">Tap to view &amp; edit</p>
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">Target date</dt>
              <dd className="mt-1 text-sm font-medium text-ink-900">
                {selected.deadline ? mediumDate(selected.deadline) : <span className="text-ink-400">Not set</span>}
              </dd>
            </div>
          </dl>

          <div className="px-5 pb-5 pt-5 sm:px-6">
            <ProgressBar
              value={selected.progress}
              tone={selected.progress >= 100 ? 'ok' : 'accent'}
              label={`${selected.title} progress`}
            />
          </div>

          {/* task table */}
          <div className="px-5 pb-6 sm:px-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-medium text-ink-600">
                Progress points{selected.milestones?.length ? ` (${selected.milestones.filter((m) => m.completed).length} of ${selected.milestones.length} done)` : ''}
              </span>
              <Button variant="secondary" size="sm" onClick={() => { setMilestoneTarget(selected); setMilestoneName(''); setMilestoneError(''); }}>
                <Plus className="h-3.5 w-3.5" /> Add progress point
              </Button>
            </div>
            {selected.milestones?.length ? (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-paper-deep/50 border-b border-line">
                      <th className="w-12 px-3 py-2 text-center text-2xs uppercase tracking-wide2 text-ink-400 font-medium">#</th>
                      <th className="px-3 py-2 text-left text-2xs uppercase tracking-wide2 text-ink-400 font-medium">Task</th>
                      <th className="w-32 px-3 py-2 text-center text-2xs uppercase tracking-wide2 text-ink-400 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {selected.milestones.map((m, idx) => (
                      <tr key={idx} className="hover:bg-paper-deep/40">
                        <td className="px-3 py-2.5 text-center text-2xs tabular-nums text-ink-400">{idx + 1}</td>
                        <td className="px-3 py-2.5 text-ink-900 break-words">{m.name}</td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Checkbox
                              checked={!!m.completed}
                              onChange={() => toggleMilestone(selected._id, idx)}
                              label={m.completed ? 'Completed' : 'Not completed'}
                            />
                            <button
                              type="button"
                              aria-label={`Remove progress point ${m.name}`}
                              onClick={() => setConfirm({
                                id: selected._id,
                                index: idx,
                                title: `Remove “${m.name}”?`,
                                body: 'This removes the progress point from this project. Hours logged are not affected.',
                                confirmLabel: 'Remove point',
                              })}
                              className="pressable rounded p-1 text-ink-300 hover:bg-danger-soft hover:text-danger"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-line-strong px-4 py-8 text-center">
                <p className="text-sm font-medium text-ink-700">No progress points yet</p>
                <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">
                  Add the tasks this project needs. Progress is the share of them you mark complete.
                </p>
              </div>
            )}
          </div>
        </Card>
        </Reveal>
      )}

      {/* --------------------------- new project modal --------------------------- */}
      <Modal
        open={projectOpen}
        onClose={() => { setProjectOpen(false); resetProjectModal(); }}
        title="New project"
        wide
      >
        <form onSubmit={createProject} className="space-y-4">
          {projectError && <ErrorNote>{projectError}</ErrorNote>}
          <Field label="Title">
            <Input required value={projectForm.title} onChange={(e) => setProjectForm({ ...projectForm, title: e.target.value })} />
          </Field>
          <Field label="Goal">
            <Textarea rows={2} value={projectForm.goal} onChange={(e) => setProjectForm({ ...projectForm, goal: e.target.value })} placeholder="What are you building?" />
          </Field>

          {/* GitHub URL + Analyze button */}
          <Field label="Repository URL" hint="Add a GitHub URL and click Analyze to auto-detect tech stack and objectives.">
            <div className="flex gap-2">
              <Input
                type="url"
                value={projectForm.githubUrl}
                onChange={(e) => {
                  setProjectForm({ ...projectForm, githubUrl: e.target.value });
                  setAnalysisResult(null);
                  setAnalyzeError('');
                }}
                placeholder="https://github.com/owner/repo"
                className="flex-1"
              />
              <Button
                variant="accent-quiet"
                size="sm"
                onClick={analyzeRepository}
                loading={analyzeLoading}
                disabled={!projectForm.githubUrl.trim()}
                className="shrink-0"
              >
                {!analyzeLoading && <Github className="h-3.5 w-3.5" />}
                {analyzeLoading ? 'Analyzing' : 'Analyze'}
              </Button>
            </div>
            {analyzeError && (
              <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-danger" role="alert">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {analyzeError}
              </p>
            )}
          </Field>

          {/* ── Analyzer Results ── */}
          {analysisResult && (
            <div className="rounded-lg border border-accent-fade bg-accent-soft/30 p-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink-900 truncate">{analysisResult.repoMeta?.name}</p>
                  {analysisResult.repoMeta?.description && (
                    <p className="text-2xs text-ink-500 mt-0.5 line-clamp-2">{analysisResult.repoMeta.description}</p>
                  )}
                </div>
                <Badge tone="ok" dot>Analyzed</Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {TECH_CATEGORIES.map((cat) => (
                  <div key={cat}>
                    <p className="text-2xs uppercase tracking-wide2 text-ink-400 font-medium mb-2 capitalize">{cat}</p>
                    {/* Still only ONE chip geometry: these are toggle buttons,
                        so they share the badge shape and sizing, and confidence
                        is carried by the tone rather than a second shape. */}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {selectedStack[cat].map((tech, i) => (
                        <button
                          key={`${cat}-${tech.name}-${i}`}
                          type="button"
                          title={tech.evidence}
                          aria-pressed={tech.accepted}
                          onClick={() => setSelectedStack((s) => ({
                            ...s,
                            [cat]: s[cat].map((t, j) => j === i ? { ...t, accepted: !t.accepted } : t)
                          }))}
                          className={`pressable inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-sm border px-2 text-2xs font-medium ${
                            !tech.accepted
                              ? 'border-line bg-surface text-ink-300 line-through'
                              : tech.confidence === 'high'
                              ? 'border-accent bg-accent text-white'
                              : tech.confidence === 'medium'
                              ? 'border-accent-fade bg-accent-soft text-accent-strong'
                              : 'border-line-strong bg-paper-deep text-ink-600'
                          }`}
                        >
                          {tech.name}
                          {tech.accepted && <X className="h-2.5 w-2.5 opacity-70" />}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={customTech[cat]}
                        onChange={(e) => setCustomTech({ ...customTech, [cat]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && customTech[cat].trim()) {
                            e.preventDefault();
                            setSelectedStack((s) => ({
                              ...s,
                              [cat]: [...s[cat], { name: customTech[cat].trim(), confidence: 'high', evidence: 'Added manually', accepted: true }]
                            }));
                            setCustomTech({ ...customTech, [cat]: '' });
                          }
                        }}
                        placeholder="Add manually"
                        className="flex-1 rounded border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-ink-900 placeholder-ink-300 focus:border-accent focus:shadow-focus-accent focus:outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-accent-fade/60 pt-3 text-2xs text-ink-400">
                <span>Select to include</span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] border border-accent bg-accent" />
                  High confidence
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] border border-accent-fade bg-accent-soft" />
                  Medium
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] border border-line-strong bg-paper-deep" />
                  Low
                </span>
              </div>
            </div>
          )}

          <Field label="Live Demo URL (optional)">
            <Input type="url" value={projectForm.liveDemoUrl} onChange={(e) => setProjectForm({ ...projectForm, liveDemoUrl: e.target.value })} placeholder="https://my-app.vercel.app" />
          </Field>

          <Field label="Target date (optional)">
            <Input type="date" value={projectForm.deadline} onChange={(e) => setProjectForm({ ...projectForm, deadline: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <Button variant="secondary" onClick={() => { setProjectOpen(false); resetProjectModal(); }}>Cancel</Button>
            <Button type="submit">Create project</Button>
          </div>
        </form>
      </Modal>

      {/* --------------------------- log hours modal --------------------------- */}
      <Modal
        open={!!hoursTarget}
        onClose={() => setHoursTarget(null)}
        title="Log hours"
        subtitle={hoursTarget?.title}
      >
        <form onSubmit={submitHours} className="space-y-4">
          {hoursError && <ErrorNote>{hoursError}</ErrorNote>}
          <Field label="Hours worked">
            <Input
              type="number"
              min="0.5"
              step="0.5"
              value={hoursValue}
              onChange={(e) => setHoursValue(e.target.value)}
            />
          </Field>
          <Field label="What did you work on?" hint="Optional — shown in the hours log.">
            <Input
              type="text"
              maxLength={200}
              value={hoursNote}
              onChange={(e) => setHoursNote(e.target.value)}
              placeholder="e.g. API integration, bug fixing"
            />
          </Field>
          <p className="text-2xs text-ink-400">Logged today. You can correct or delete it from the hours log later.</p>
          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <Button variant="secondary" onClick={() => setHoursTarget(null)}>Cancel</Button>
            <Button type="submit">Log hours</Button>
          </div>
        </form>
      </Modal>

      {/* --------------------------- hours log (view / edit) --------------------------- */}
      <Modal
        open={!!hoursManage}
        onClose={() => setHoursManage(null)}
        title="Hours log"
        subtitle={hoursManage?.title}
        wide
      >
        <div className="space-y-4">
          {hoursFormError && <ErrorNote>{hoursFormError}</ErrorNote>}
          {hoursLogsLoading ? (
            <p className="py-6 text-center text-sm text-ink-400">Loading…</p>
          ) : hoursLogs.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">
              No dated entries yet — hours logged before this list existed still count toward the total.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {hoursLogs.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  {hoursForm?.logId === entry.id ? (
                    <form onSubmit={submitEditHours} className="w-full space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Hours">
                          <Input
                            type="number"
                            min="0.5"
                            step="0.5"
                            value={hoursForm.hours}
                            onChange={(e) => setHoursForm({ ...hoursForm, hours: e.target.value })}
                          />
                        </Field>
                        <Field label="Date">
                          <Input
                            type="date"
                            value={hoursForm.date}
                            onChange={(e) => setHoursForm({ ...hoursForm, date: e.target.value })}
                          />
                        </Field>
                      </div>
                      <Field label="Note">
                        <Input
                          type="text"
                          maxLength={200}
                          value={hoursForm.note}
                          onChange={(e) => setHoursForm({ ...hoursForm, note: e.target.value })}
                        />
                      </Field>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" size="sm" onClick={() => setHoursForm(null)}>
                          Cancel
                        </Button>
                        <Button type="submit" size="sm">Save</Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900">
                          <span className="tabular-nums">{entry.hours}</span> hours
                          <span className="ml-2 font-normal text-ink-400">{mediumDate(entry.date)}</span>
                        </p>
                        {entry.note && <p className="mt-0.5 truncate text-xs text-ink-500">{entry.note}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Edit ${entry.hours} hour entry`}
                          onClick={() => openEditHours(entry)}
                          className="pressable rounded p-1.5 text-ink-400 hover:bg-paper-deep hover:text-ink-900"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${entry.hours} hour entry`}
                          onClick={() => deleteHoursEntry(entry)}
                          className="pressable rounded p-1.5 text-ink-400 hover:bg-danger-soft hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line pt-3 text-2xs text-ink-400">
            Deleting or editing an entry updates the project's total immediately.
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => { setHoursManage(null); openLogHours(hoursManage); }}>
              <Plus className="h-3.5 w-3.5" /> Log more hours
            </Button>
          </div>
        </div>
      </Modal>

      {/* --------------------------- add milestone modal --------------------------- */}
      <Modal
        open={!!milestoneTarget}
        onClose={() => setMilestoneTarget(null)}
        title="Add progress point"
        subtitle={milestoneTarget?.title}
      >
        <form onSubmit={submitMilestone} className="space-y-4">
          {milestoneError && <ErrorNote>{milestoneError}</ErrorNote>}
          <Field label="Point name">
            <Input
              required
              value={milestoneName}
              onChange={(e) => setMilestoneName(e.target.value)}
              placeholder="e.g., Implement dark mode"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <Button variant="secondary" onClick={() => setMilestoneTarget(null)}>Cancel</Button>
            <Button type="submit">Add point</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={runDelete}
        danger
        confirmLabel={confirm?.confirmLabel || 'Delete'}
        title={confirm?.title || ''}
        body={confirm?.body || ''}
      />
    </PageFrame>
  );
};

export default ProjectsPage;
