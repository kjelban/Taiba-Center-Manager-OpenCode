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

  clockIn: async (employee: Employee): Promise<Attendance> => {
    const token = getServerSessionToken();
    if (!token) throw new Error('Not authenticated');
    const resp = await fetch('/api/clockin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ employeeId: employee.id, employeeName: employee.name }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Clock-in failed');
    }
    return await resp.json();
  },

  clockOut: async (recordId: string): Promise<void> => {
    const token = getServerSessionToken();
    if (!token) throw new Error('Not authenticated');
    const resp = await fetch('/api/clockout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id: recordId }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Clock-out failed');
    }
  },
};
