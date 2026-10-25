// Test setup file for Vitest
import { vi } from 'vitest';

// Mock console methods to reduce noise in tests (optional)
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeAll(() => {
  // Uncomment to silence console in tests
  // console.log = vi.fn();
  // console.error = vi.fn();
  // console.warn = vi.fn();
});

afterAll(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

// Global test timeout
vi.setConfig({ testTimeout: 10000 });