import React, { useCallback, useEffect, useState } from 'react';
import API from '../services/api';
import { SemesterSection, SubjectsSection } from './academics/SetupSections';
import { TimetableSection } from './academics/TimetableSection';
import { AttendanceSection } from './academics/AttendanceSection';
import { AssessmentsSection } from './academics/AssessmentsSection';
import { PageHeader } from '../components/common/ui';

export const Academics = () => {
  const [overview, setOverview] = useState(null);
  const [semesters, setSemesters] = useState([]);
  const [gridData, setGridData] = useState(null);
  const [gridLoading, setGridLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchCore = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, semRes] = await Promise.all([
        API.get('/academics/overview'),
        API.get('/academics/semesters'),
      ]);
      if (ovRes.data?.success) setOverview(ovRes.data);
      if (semRes.data?.success) setSemesters(semRes.data.semesters || []);
    } catch (err) {
      console.error('Error loading academics:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGrid = useCallback(async () => {
    setGridLoading(true);
    try {
      const res = await API.get('/academics/timetable/grid');
      if (res.data?.success) setGridData(res.data);
    } catch (err) {
      console.error('Error loading timetable grid:', err);
    } finally {
      setGridLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCore();
    fetchGrid();
  }, [fetchCore, fetchGrid]);

  const activeSemester = semesters.find((s) => s.isActive) || null;

  const refreshAll = () => {
    fetchCore();
    fetchGrid();
  };

  if (loading && !overview) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 rounded-md bg-paper-deep animate-pulse" />
        <div className="h-40 rounded-lg bg-paper-deep animate-pulse" />
      </div>
    );
  }

  /*
   * Architecture: dedicated scroll viewport.
   *
   * The outer wrapper uses negative margins to cancel AppLayout <main> padding
   * so the scroll container occupies exactly (100vh - 4rem header).
   *
   * Each inner div is exactly the container height with overflow-y: auto so its
   * content scrolls internally. Only after reaching the section bottom does the
   * outer snap-y container advance to the next section — no looping.
   */
  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -my-6 lg:-my-8">
      {/* Outer snap viewport */}
      <div
        className="overflow-y-auto scroll-smooth"
        style={{
          height: 'calc(100vh - 4rem)',
          scrollSnapType: 'y mandatory',
        }}
      >
        {/* ── Section 1: Semester + Subject Registration ── */}
        <div
          className="flex-shrink-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8"
          style={{ height: 'calc(100vh - 4rem)', scrollSnapAlign: 'start' }}
        >
          <PageHeader
            meta="Academics"
            title="Semester"
            description="Manage subjects, timetable, assessments, and attendance for the selected semester."
          />

          <SemesterSection
            semesters={semesters}
            activeSemester={activeSemester}
            onChanged={refreshAll}
          />

          <SubjectsSection
            subjects={overview?.subjects || []}
            onChanged={refreshAll}
            semesterReady={!!activeSemester}
          />
        </div>

        {/* ── Section 2: Weekly Timetable ── */}
        <div
          className="flex-shrink-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-8"
          style={{ height: 'calc(100vh - 4rem)', scrollSnapAlign: 'start' }}
        >
          <TimetableSection
            activeSemester={activeSemester}
            subjects={overview?.subjects || []}
            gridData={gridData}
            gridLoading={gridLoading}
            onChanged={refreshAll}
          />
        </div>

        {/* ── Section 3: Assessments ── */}
        <div
          className="flex-shrink-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-8"
          style={{ height: 'calc(100vh - 4rem)', scrollSnapAlign: 'start' }}
        >
          <AssessmentsSection />
        </div>

        {/* ── Section 4: Attendance (final) ── */}
        <div
          className="flex-shrink-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-8 pb-16"
          style={{ height: 'calc(100vh - 4rem)', scrollSnapAlign: 'start' }}
        >
          <AttendanceSection overview={overview} onChanged={refreshAll} />
        </div>
      </div>
    </div>
  );
};

export default Academics;
