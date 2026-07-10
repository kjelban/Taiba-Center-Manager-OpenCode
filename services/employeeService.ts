import { Employee, Attendance } from '../types';
import { COLLECTIONS, getAll, setData, deleteData, subscribeToCollection } from './base';
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';

export const EmployeeService = {
  getEmployees: async (): Promise<Employee[]> => {
    return await getAll<Employee>(COLLECTIONS.EMPLOYEES);
  },

  subscribeToEmployees: (callback: (employees: Employee[]) => void) => {
    return subscribeToCollection<Employee>(COLLECTIONS.EMPLOYEES, callback);
  },

  saveEmployee: async (employee: Employee): Promise<void> => {
    await setData(COLLECTIONS.EMPLOYEES, employee.id, employee);
  },

  deleteEmployee: async (id: string): Promise<void> => {
    await deleteData(COLLECTIONS.EMPLOYEES, id);
  },

  getEmployee: async (id: string): Promise<Employee | null> => {
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.EMPLOYEES, id));
      if (snap.exists()) return snap.data() as Employee;
      return null;
    } catch {
      return null;
    }
  },
};

export const AttendanceService = {
  getAttendance: async (): Promise<Attendance[]> => {
    return await getAll<Attendance>(COLLECTIONS.ATTENDANCE);
  },

  subscribeToAttendance: (callback: (attendance: Attendance[]) => void) => {
    return subscribeToCollection<Attendance>(COLLECTIONS.ATTENDANCE, callback);
  },

  closeRecord: async (record: Attendance): Promise<void> => {
    if (record.checkOutTime) return;
    const now = new Date();
    const diffMs = now.getTime() - new Date(record.checkInTime).getTime();
    const diffMins = Math.round(diffMs / 60000);
    record.checkOutTime = now.toISOString();
    record.durationMinutes = diffMins;
    await setData(COLLECTIONS.ATTENDANCE, record.id, record);
  },

  autoCloseOpenSessions: async (employeeId?: string): Promise<void> => {
    try {
      const allRecords = await AttendanceService.getAttendance();
      const now = Date.now();
      for (const record of allRecords) {
        if (record.checkOutTime) continue;
        if (employeeId && record.employeeId !== employeeId) continue;
        const checkIn = new Date(record.checkInTime).getTime();
        if ((now - checkIn) > 12 * 60 * 60 * 1000) {
          await AttendanceService.closeRecord(record);
        }
      }
    } catch { }
  },

  clockIn: async (employee: Employee): Promise<Attendance> => {
    await AttendanceService.autoCloseOpenSessions(employee.id);
    const now = new Date();
    const newRecord: Attendance = {
      id: crypto.randomUUID(),
      employeeId: employee.id,
      employeeName: employee.name,
      date: now.toISOString().split('T')[0],
      checkInTime: now.toISOString(),
      checkOutTime: null,
      durationMinutes: null,
    };
    await setData(COLLECTIONS.ATTENDANCE, newRecord.id, newRecord);
    return newRecord;
  },

  clockOut: async (recordId: string): Promise<void> => {
    const attSnap = await getDoc(doc(db, COLLECTIONS.ATTENDANCE, recordId));
    if (!attSnap.exists()) return;
    const record = attSnap.data() as Attendance;
    await AttendanceService.closeRecord(record);
  },
};
