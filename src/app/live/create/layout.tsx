import type { Metadata } from 'next';
import { zukeConfig } from '@/zuke.config';

export const metadata: Metadata = {
  title: `Create a room - ${zukeConfig.name}`,
  description: 'Start a Juke audio room on Zuke with the team create-password.',
  robots: { index: false },
};

export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
