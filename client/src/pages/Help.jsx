import React from 'react';
import PublicShell from '../components/PublicShell.jsx';
import HelpCenter from '../components/HelpCenter.jsx';

export default function Help() {
  return (
    <PublicShell
      active="/help"
      title="帮助中心"
      subtitle="从注册到部署，常见问题与上手指引都在这里。搜一搜，快速解决疑难杂症。"
    >
      <HelpCenter />
    </PublicShell>
  );
}
