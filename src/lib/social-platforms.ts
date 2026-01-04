import type React from 'react';
import { FiInstagram, FiGithub, FiYoutube, FiGlobe, FiFacebook } from 'react-icons/fi';
import {
  SiTiktok,
  SiLine,
  SiTwitch,
  SiDiscord,
  SiX,
  SiBluesky,
  SiSnapchat,
  SiThreads,
  SiBereal,
} from 'react-icons/si';

export type SocialPlatform = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  placeholder: string;
  baseUrl?: string;
  handlePlaceholder?: string;
};

export const socialPlatforms: SocialPlatform[] = [
  { key: 'tiktok', label: 'TikTok', icon: SiTiktok, placeholder: 'https://tiktok.com/@username', baseUrl: 'https://tiktok.com/@', handlePlaceholder: 'username' },
  { key: 'instagram', label: 'Instagram', icon: FiInstagram, placeholder: 'https://instagram.com/username', baseUrl: 'https://instagram.com/', handlePlaceholder: 'username' },
  { key: 'x', label: 'X (Twitter)', icon: SiX, placeholder: 'https://x.com/username', baseUrl: 'https://x.com/', handlePlaceholder: 'username' },
  { key: 'youtube', label: 'YouTube', icon: FiYoutube, placeholder: 'https://youtube.com/@username', baseUrl: 'https://youtube.com/@', handlePlaceholder: 'username' },
  { key: 'bereal', label: 'BeReal', icon: SiBereal, placeholder: 'https://bere.al/username', baseUrl: 'https://bere.al/', handlePlaceholder: 'username' },
  { key: 'line', label: 'LINE', icon: SiLine, placeholder: 'https://line.me/ti/p/username', baseUrl: 'https://line.me/ti/p/', handlePlaceholder: 'username' },
  { key: 'threads', label: 'Threads', icon: SiThreads, placeholder: 'https://threads.net/@username', baseUrl: 'https://threads.net/@', handlePlaceholder: 'username' },
  { key: 'bluesky', label: 'Bluesky', icon: SiBluesky, placeholder: 'https://bsky.app/profile/username.bsky.social', baseUrl: 'https://bsky.app/profile/', handlePlaceholder: 'handle.bsky.social' },
  { key: 'github', label: 'GitHub', icon: FiGithub, placeholder: 'https://github.com/username', baseUrl: 'https://github.com/', handlePlaceholder: 'username' },
  { key: 'discord', label: 'Discord', icon: SiDiscord, placeholder: 'https://discord.gg/invite', baseUrl: 'https://discord.gg/', handlePlaceholder: 'invite-code' },
  { key: 'snapchat', label: 'Snapchat', icon: SiSnapchat, placeholder: 'https://snapchat.com/add/username', baseUrl: 'https://snapchat.com/add/', handlePlaceholder: 'username' },
  { key: 'twitch', label: 'Twitch', icon: SiTwitch, placeholder: 'https://twitch.tv/username', baseUrl: 'https://twitch.tv/', handlePlaceholder: 'username' },
  { key: 'facebook', label: 'Facebook', icon: FiFacebook, placeholder: 'https://facebook.com/username', baseUrl: 'https://facebook.com/', handlePlaceholder: 'username' },
  { key: 'website', label: 'Website', icon: FiGlobe, placeholder: 'https://yourwebsite.com', baseUrl: 'https://', handlePlaceholder: 'yourwebsite.com' },
];
