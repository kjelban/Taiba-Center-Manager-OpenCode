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

  clockIn: async (employee: Employee): Promise<Attendance> => {
    const now = new Date();
    const newRecord: Attendance = {
      id: crypto.randomUUID(),
      employeeId: employee.id,
      employeeName: employee.name,
      date: now.toISOString().split('T')[0],
      checkInTime: now.toISOString(),
    };
    await setData(COLLECTIONS.ATTENDANCE, newRecord.id, newRecord);
    return newRecord;
  },

  clockOut: async (recordId: string): Promise<void> => {
    const attSnap = await getDoc(doc(db, COLLECTIONS.ATTENDANCE, recordId));
    if (!attSnap.exists()) return;
    const record = attSnap.data() as Attendance;
    const now = new Date();
    const diffMs = now.getTime() - new Date(record.checkInTime).getTime();
    const diffMins = Math.round(diffMs / 60000);
    record.checkOutTime = now.toISOString();
    record.durationMinutes = diffMins;
    await setData(COLLECTIONS.ATTENDANCE, recordId, record);
  },
};
