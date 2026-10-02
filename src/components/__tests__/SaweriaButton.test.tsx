// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { SaweriaButton } from '@/components/SaweriaButton';

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

afterEach(cleanup);

describe('SaweriaButton', () => {
  it('SAW-01: renders a Saweria support button', () => {
    render(<SaweriaButton />);
    expect(screen.getByRole('button', { name: /saweria/i })).toBeInTheDocument();
  });

  it('SAW-02: clicking opens the Saweria URL', () => {
    render(<SaweriaButton />);
    fireEvent.click(screen.getByRole('button', { name: /saweria/i }));
    expect(openUrl).toHaveBeenCalledWith('https://saweria.co/latiefahmad');
  });
});
