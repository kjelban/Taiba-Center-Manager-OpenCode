import { Employee, Attendance } from '../types';
import { COLLECTIONS, getAll, setData, deleteData, subscribeToCollection } from './base';
import { db } from './firebase';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

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
    const checkOut = record.checkOutTime ? new Date(record.checkOutTime) : new Date();
    const diffMs = checkOut.getTime() - new Date(record.checkInTime).getTime();
    const diffMins = Math.round(diffMs / 60000);
    if (!record.checkOutTime) {
      record.checkOutTime = checkOut.toISOString();
    }
    record.durationMinutes = diffMins;
    await setData(COLLECTIONS.ATTENDANCE, record.id, record);
  },

  autoCloseOpenSessions: async (employeeId?: string): Promise<void> => {
    try {
      const q = query(collection(db, COLLECTIONS.ATTENDANCE), where('checkOutTime', '==', null));
      const snapshot = await getDocs(q);
      for (const docSnap of snapshot.docs) {
        const record = docSnap.data() as Attendance;
        if (employeeId && record.employeeId !== employeeId) continue;
        await AttendanceService.closeRecord(record);
      }
    } catch { }
  },

  getActiveSession: async (employeeId: string): Promise<Attendance | null> => {
    try {
      const q = query(
        collection(db, COLLECTIONS.ATTENDANCE),
        where('employeeId', '==', employeeId),
        where('checkOutTime', '==', null)
      );
      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;
      let latest: Attendance | null = null;
      for (const docSnap of snapshot.docs) {
        const record = docSnap.data() as Attendance;
        if (!latest || record.checkInTime > latest.checkInTime) {
          latest = record;
        }
      }
      return latest;
    } catch {
      return null;
    }
  },

  clockIn: async (employee: Employee): Promise<Attendance> => {
    const existing = await AttendanceService.getActiveSession(employee.id);
    if (existing) {
      return existing;
    }
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
