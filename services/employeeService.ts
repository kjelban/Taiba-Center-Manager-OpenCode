import { Employee, Attendance } from '../types';
import { COLLECTIONS, getAll, setData, deleteData, subscribeToCollection, getServerSessionToken } from './base';
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

  getActiveSession: async (employeeId?: string): Promise<Attendance | null> => {
    const token = getServerSessionToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const resp = await fetch('/api/attendance/active', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ employeeId }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.session || null;
    } catch {
      return null;
    }
  },

  clockIn: async (employee: Employee): Promise<Attendance> => {
    const token = getServerSessionToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch('/api/clockin', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ employeeId: employee.id, employeeName: employee.name }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Clock-in failed');
    }
    const data = await resp.json();
    return data.record || data;
  },

  clockOut: async (recordId: string): Promise<void> => {
    const token = getServerSessionToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch('/api/clockout', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ attendanceId: recordId, id: recordId }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Clock-out failed');
    }
  },
};
