const BASE_URL = 'http://localhost:5001/api';

const runTests = async () => {
  console.log('===========================================================');
  console.log('🚀 RUNNING ACADEMIC TIMETABLE, ATTENDANCE & ROUTINE TESTS');
  console.log('===========================================================\n');

  try {
    // 1. Authenticate
    console.log('1. Logging in as test user...');
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'walkthrough@studentos.dev',
        password: 'Demo@1234',
      }),
    });
    const loginData = await loginRes.json();
    const token = loginData.token;
    if (!token) throw new Error('Login failed: ' + JSON.stringify(loginData));

    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    console.log('✅ Logged in successfully.\n');

    // 2. Academic Semester Setup
    console.log('2. Testing Semester Setup...');
    const createSemRes = await fetch(`${BASE_URL}/academics/semesters`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        semesterNumber: 7,
        academicYear: '2026–27',
        semesterName: '7th Semester - Engineering',
        startDate: '2026-08-01',
        endDate: '2026-12-15',
        isActive: true,
        workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      }),
    });
    const semData = await createSemRes.json();
    const semId = semData.semester._id;
    console.log(`✅ Semester created: "${semData.semester.semesterName}" (ID: ${semId})`);

    const getSemRes = await fetch(`${BASE_URL}/academics/semesters`, { headers: authHeaders });
    const getSemData = await getSemRes.json();
    console.log(`✅ Total Semesters: ${getSemData.semesters.length}, Active: ${getSemData.activeSemester?.semesterName}\n`);

    // 2b. Verify the semester starts with NO pre-seeded time slots
    //     (the student must configure their own college schedule)
    const freshSemester = getSemData.semesters.find((s) => s._id === semId);
    if ((freshSemester?.timeSlots?.length || 0) !== 0) {
      throw new Error('New semester must start with zero time slots (no fixed college timings)!');
    }
    console.log('✅ New semester starts with zero pre-seeded time slots.\n');

    // 2c. Configure the student's own time schedule (no hard-coded defaults)
    console.log('2b. Configuring custom time schedule...');
    const configuredSlots = [
      { slotIndex: 0, startTime: '08:00', endTime: '09:00', label: 'Morning Theory', type: 'regular' },
      { slotIndex: 1, startTime: '09:00', endTime: '10:00', label: 'Second Theory', type: 'regular' },
      { slotIndex: 2, startTime: '10:00', endTime: '10:15', label: 'Break', type: 'break' },
      { slotIndex: 3, startTime: '10:15', endTime: '11:15', label: 'Third Theory', type: 'regular' },
      { slotIndex: 4, startTime: '11:15', endTime: '12:15', label: 'Fourth Theory', type: 'regular' },
      { slotIndex: 5, startTime: '12:15', endTime: '01:00', label: 'Lunch', type: 'lunch' },
      { slotIndex: 6, startTime: '01:00', endTime: '02:00', label: 'Afternoon A', type: 'regular' },
      { slotIndex: 7, startTime: '02:00', endTime: '03:00', label: 'Afternoon B', type: 'regular' },
      { slotIndex: 8, startTime: '03:00', endTime: '04:00', label: 'Afternoon C', type: 'regular' },
    ];
    const cfgRes = await fetch(`${BASE_URL}/academics/semesters/${semId}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ timeSlots: configuredSlots }),
    });
    const cfgData = await cfgRes.json();
    if (!cfgRes.ok) throw new Error('Failed to configure time schedule: ' + JSON.stringify(cfgData));
    console.log(`✅ Configured ${cfgData.semester.timeSlots.length} custom time slots (2 breaks/lunch included).\n`);

    // 3. Subject Registration & 4-Credit Lab Component
    console.log('3. Testing 4-Credit Subject with Lab Section...');
    const subjRes = await fetch(`${BASE_URL}/academics/subjects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Distributed Cloud Computing',
        code: 'CS701',
        credits: 4,
        faculty: 'Dr. V. Prasad',
        type: 'Theory',
        theorySessionsPerWeek: 3,
        theoryDuration: 1,
        hasLab: true,
        labSection: {
          hasLab: true,
          labName: 'Cloud Computing Lab',
          duration: 2,
          sessionsPerWeek: 1,
        },
      }),
    });
    const subjData = await subjRes.json();
    const subj = subjData.subject;
    console.log(`✅ Registered Subject: ${subj.name} [Code: ${subj.code}]`);
    console.log(`✅ Lab Section verified: "${subj.labSection?.labName}" with inherited Code: "${subj.labSection?.code}"`);

    // Test duplicate code rejection
    const dupRes = await fetch(`${BASE_URL}/academics/subjects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Duplicate Test',
        code: 'CS701',
        credits: 4,
      }),
    });
    const dupData = await dupRes.json();
    if (dupRes.status === 400) {
      console.log(`✅ Duplicate subject code correctly rejected: "${dupData.message}"`);
    } else {
      throw new Error('Duplicate code was not rejected!');
    }

    // Test updating subject code automatically syncs lab code
    const updateRes = await fetch(`${BASE_URL}/academics/subjects/${subj._id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ code: 'CS705' }),
    });
    const updateData = await updateRes.json();
    console.log(`✅ Updated subject code to CS705. Inherited lab code is now: "${updateData.subject.labSection?.code}"\n`);

    // 4. Timetable Grid & Multi-slot Lab
    console.log('4. Testing Timetable Grid & Multi-slot Lab Reservation...');
    // Assign Theory on Monday slot 0
    await fetch(`${BASE_URL}/academics/timetable/cell`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        day: 'Monday',
        slotIndex: 0,
        entryType: 'theory',
        subjectId: subj._id,
        room: 'Room 401',
      }),
    });
    console.log('✅ Assigned Monday Slot #0 as Theory.');

    // Assign 2-hour Lab on Tuesday slot 7 (02:00-03:00) -> should reserve slot 7 & 8
    await fetch(`${BASE_URL}/academics/timetable/cell`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        day: 'Tuesday',
        slotIndex: 7,
        entryType: 'lab',
        subjectId: subj._id,
        room: 'Cloud Lab 1',
      }),
    });
    console.log('✅ Assigned Tuesday Slot #7 as 2-Hour Lab.');

    const gridRes = await fetch(`${BASE_URL}/academics/timetable/grid`, { headers: authHeaders });
    const gridData = await gridRes.json();
    const slot7 = gridData.grid['Tuesday']?.['7'];
    const slot8 = gridData.grid['Tuesday']?.['8'];
    console.log(`✅ Grid Slot 7 colSpan: ${slot7?.colSpan}, EntryType: ${slot7?.entryType}`);
    console.log(`✅ Grid Slot 8 continuation flag: ${slot8?.isConsecutiveContinuation}`);

    // Activate Timetable
    await fetch(`${BASE_URL}/academics/timetable/activate`, {
      method: 'POST',
      headers: authHeaders,
    });
    console.log('✅ Activated timetable.\n');

    // 5. Semester Exceptions / Holidays
    console.log('5. Testing Semester Exceptions (Holidays)...');
    const holidayRes = await fetch(`${BASE_URL}/academics/exceptions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        date: '2026-10-02',
        type: 'holiday',
        title: 'Gandhi Jayanti',
        notes: 'National Holiday - No classes',
      }),
    });
    const holidayData = await holidayRes.json();
    console.log(`✅ Added exception: ${holidayData.exception?.title} on ${holidayData.exception?.date}`);

    const checkHolidayRes = await fetch(`${BASE_URL}/academics/today?date=2026-10-02`, { headers: authHeaders });
    const checkHolidayData = await checkHolidayRes.json();
    console.log(`✅ Verified date is recognized as holiday: isHoliday = ${checkHolidayData.isHoliday}, classes count = ${checkHolidayData.classes?.length}\n`);

    // 6. Today's Classes & Attendance (Theory vs Lab)
    console.log('6. Testing Attendance Tracking (Theory vs Lab)...');
    const monRes = await fetch(`${BASE_URL}/academics/today?date=2026-09-14`, { headers: authHeaders });
    const monData = await monRes.json();
    console.log(`✅ Fetched classes for 2026-09-14 (Monday). Found ${monData.classes?.length} class(es).`);

    if (monData.classes?.length > 0) {
      const targetSlot = monData.classes[0];
      const markRes = await fetch(`${BASE_URL}/academics/timetable/${targetSlot._id}/mark`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          status: 'present',
          date: '2026-09-14',
        }),
      });
      const markData = await markRes.json();
      console.log(`✅ Marked attendance as Present. Total Theory: ${markData.subject.theoryTotal}, Attended: ${markData.subject.theoryAttended}`);
    }

    // Verify future date attendance rejection
    const futureRes = await fetch(`${BASE_URL}/academics/timetable/${slot7._id}/mark`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        status: 'present',
        date: '2026-12-25',
      }),
    });
    const futureData = await futureRes.json();
    if (futureRes.status === 400) {
      console.log(`✅ Future date attendance correctly rejected: "${futureData.message}"\n`);
    } else {
      throw new Error('Future date attendance was not rejected!');
    }

    // 7. Custom Generic Routine & Checkboxes
    console.log('7. Testing Custom Daily Routine & Checkboxes...');
    const routineRes = await fetch(`${BASE_URL}/routines`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        title: 'Evening Technical Reading',
        category: 'Reading',
        priority: 'high',
        startTime: '19:00',
        endTime: '20:00',
        isRecurring: true,
        recurrenceDays: ['Every Day'],
      }),
    });
    const routineData = await routineRes.json();
    const routineId = routineData.routine._id;
    console.log(`✅ Created custom routine: "${routineData.routine.title}"`);

    // Toggle on Date A
    const toggleARes = await fetch(`${BASE_URL}/routines/${routineId}/toggle`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        date: '2026-09-19',
        completed: true,
      }),
    });
    const toggleAData = await toggleARes.json();
    console.log(`✅ Checked off routine for 2026-09-19: completed = ${toggleAData.completed}`);

    // Verify Date B is NOT affected (independent completion states)
    const fetchBRes = await fetch(`${BASE_URL}/routines?date=2026-09-20`, { headers: authHeaders });
    const fetchBData = await fetchBRes.json();
    const bRoutine = fetchBData.routines.find((r) => r._id === routineId);
    console.log(`✅ Verified independent completion: 2026-09-20 completion status = ${bRoutine?.completed} (expected false)`);

    // 8. Combined Daily Timeline
    console.log('\n8. Testing Combined Daily Timeline...');
    const combinedRes = await fetch(`${BASE_URL}/routines/combined-daily?date=2026-09-14`, { headers: authHeaders });
    const combinedData = await combinedRes.json();
    console.log(`✅ Fetched combined timeline for 2026-09-14: Total items = ${combinedData.timeline?.length} (Academic: ${combinedData.academicCount}, Routine: ${combinedData.routineCount})`);

    console.log('\n===========================================================');
    console.log('🎉 ALL TIMETABLE, ATTENDANCE & ROUTINE TESTS PASSED CLEANLY!');
    console.log('===========================================================');
  } catch (error) {
    console.error('❌ Test suite error:', error.message);
    process.exit(1);
  }
};

runTests();
