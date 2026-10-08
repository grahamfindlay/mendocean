// Fictional BHC signup responses. No saved lineups, boat assignments or seats.
export const attendanceFixtureId = "c68221b7-f064-4b4d-aec5-4b616329925e";
export const attendanceFixtureTitle = "Upcoming attendance test";
export function signupFixture(athlete: number) {
  return {
    lineups_set: "No",
    attendance: [
      {
        custid: athlete,
        fname: "Graham",
        lname: "Findlay",
        attendance_plan: "Unknown",
      },
      {
        custid: 912000001,
        fname: "Jordan",
        lname: "Ellis",
        attendance_plan: "Attending",
      },
      {
        custid: 912000004,
        fname: "Nora",
        lname: "Sullivan",
        attendance_plan: "Attending",
      },
      {
        custid: 912000005,
        fname: "Micah",
        lname: "Rivera",
        attendance_plan: "Attending",
      },
      {
        custid: 912000006,
        fname: "Polyanna",
        lname: "Nunes Da Silva",
        attendance_plan: "Attending",
      },
      {
        custid: 912000002,
        fname: "Pat",
        lname: "Lee",
        attendance_plan: "Not Attending",
      },
      {
        custid: 912000003,
        fname: "Sam",
        lname: "Avery",
        attendance_plan: "Unknown",
      },
    ],
  };
}
