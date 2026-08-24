import React, { useState, useEffect, useRef } from 'react';

const API_BASE_URL = 'http://localhost:8000';

function App() {
  const [videos, setVideos] = useState([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState([]);
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestType, setIngestType] = useState('video'); // 'video' | 'playlist'
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestMessage, setIngestMessage] = useState({ text: '', type: '' }); // type: 'success' | 'error'
  
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState([
    {
      sender: 'bot',
      text: "Hello! Ingest a YouTube video or playlist on the left, then ask me anything. You can click on specific videos in the Bento Grid to limit the search scope, or leave them unselected to search across everything.",
    },
  ]);
  const [isAnswering, setIsAnswering] = useState(false);
  const [answerLanguage, setAnswerLanguage] = useState('auto');

  const chatEndRef = useRef(null);
  const chatHistoryRef = useRef(null);

  // Fetch all videos from backend
  const fetchVideos = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/videos`);
      if (res.ok) {
        const data = await res.json();
        setVideos(data);
      }
    } catch (err) {
      console.error('Error fetching videos:', err);
    }
  };

  // Poll for video updates if there are pending/ingesting videos
  useEffect(() => {
    fetchVideos();
    const interval = setInterval(() => {
      fetchVideos();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Scroll to bottom of chat only if user is already near the bottom
  useEffect(() => {
    const container = chatHistoryRef.current;
    if (container) {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isNearBottom) {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isAnswering]);

  // Handle URL ingestion
  const handleIngest = async (e) => {
    e.preventDefault();
    if (!ingestUrl.trim()) return;

    setIsIngesting(true);
    setIngestMessage({ text: '', type: '' });

    const endpoint = ingestType === 'video' ? '/ingest/video' : '/ingest/playlist';
    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ingestUrl.trim() }),
      });

      const data = await res.json();

      if (res.ok) {
        setIngestMessage({
          text: ingestType === 'video' 
            ? `Successfully started ingestion for "${data.title || 'Video'}"!`
            : 'Playlist ingestion successfully triggered in the background!',
          type: 'success',
        });
        setIngestUrl('');
        fetchVideos();
      } else {
        setIngestMessage({
          text: data.detail || 'Failed to ingest. Please verify the URL.',
          type: 'error',
        });
      }
    } catch (err) {
      setIngestMessage({
        text: 'Network error. Make sure the backend server is running.',
        type: 'error',
      });
    } finally {
      setIsIngesting(false);
    }
  };

  // Handle Ask Query
  const handleAsk = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isAnswering) return;

    const userQuestion = chatInput.trim();
    setMessages((prev) => [...prev, { sender: 'user', text: userQuestion }]);
    setChatInput('');
    setIsAnswering(true);

    try {
      const res = await fetch(`${API_BASE_URL}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: userQuestion,
          video_ids: selectedVideoIds.length > 0 ? selectedVideoIds : null,
          answer_language: answerLanguage,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        const fullText = data.answer;
        const words = fullText.split(' ');
        let currentText = '';
        let wordIdx = 0;

        // Add empty bot message
        setMessages((prev) => [...prev, { sender: 'bot', text: '' }]);

        const streamInterval = setInterval(() => {
          if (wordIdx < words.length) {
            currentText += (wordIdx === 0 ? '' : ' ') + words[wordIdx];
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { sender: 'bot', text: currentText };
              return updated;
            });
            wordIdx++;
          } else {
            clearInterval(streamInterval);
          }
        }, 22); // 22ms per word is a very smooth streaming rate!
      } else {
        setMessages((prev) => [
          ...prev,
          { sender: 'bot', text: `Error: ${data.detail || 'Could not fetch answer.'}` },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: 'bot', text: 'Network error. Make sure the backend server is running.' },
      ]);
    } finally {
      setIsAnswering(false);
    }
  };

  // Toggle video selection for scoped queries
  const toggleVideoSelect = (videoId) => {
    setSelectedVideoIds((prev) =>
      prev.includes(videoId)
        ? prev.filter((id) => id !== videoId)
        : [...prev, videoId]
    );
  };

  // Delete an ingested or failed video
  const handleDeleteVideo = async (e, videoId) => {
    e.stopPropagation(); // Prevent toggling selection when clicking delete
    if (!window.confirm("Are you sure you want to delete this video and all of its chunks from the database?")) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/videos/${videoId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSelectedVideoIds((prev) => prev.filter((id) => id !== videoId));
        fetchVideos();
      } else {
        const data = await res.json();
        alert(data.detail || "Failed to delete video.");
      }
    } catch (err) {
      alert("Network error. Could not connect to the server.");
    }
  };

  // Copy code blocks to clipboard
  const handleCopyCode = (codeText, btnId) => {
    navigator.clipboard.writeText(codeText);
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.innerText = 'Copied!';
      btn.style.background = 'var(--accent-green)';
      setTimeout(() => {
        btn.innerText = 'Copy';
        btn.style.background = 'rgba(255, 255, 255, 0.1)';
      }, 2000);
    }
  };

  // Helper to parse markdown (bold, list, blockquote, link, code, dividers, headings, codeblocks, tables) into styled React tags
  const renderMarkdown = (text) => {
    if (!text) return '';

    const lines = text.split('\n');
    const renderedElements = [];
    let listItems = [];
    let inCodeBlock = false;
    let codeLines = [];
    let codeLanguage = 'code';
    let inTable = false;
    let tableHeaders = [];
    let tableRows = [];

    const parseTime = (url) => {
      try {
        const urlObj = new URL(url);
        let t = urlObj.searchParams.get('t');
        if (!t) {
          t = urlObj.searchParams.get('time_continue');
        }
        if (t) {
          const sec = parseInt(t, 10);
          if (!isNaN(sec)) {
            const hrs = Math.floor(sec / 3600);
            const mins = Math.floor((sec % 3600) / 60);
            const secs = sec % 60;
            if (hrs > 0) {
              return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }
            return `${mins}:${secs.toString().padStart(2, '0')}`;
          }
        }
      } catch (e) {}
      return null;
    };

    const parseInline = (line) => {
      let parts = [line];

      // 1. Bracket-then-URL link: 【Text】URL or 【Text】(URL) or [Text]URL -> <a> citation badge
      const bracketAndUrlRegex = /(?:【|\[)([^\]】]+)(?:】|\])\s*\(?\s*(https?:\/\/[^\s\)\],】]+)\)?/g;
      let nextParts = [];
      for (const part of parts) {
        if (typeof part !== 'string') {
          nextParts.push(part);
          continue;
        }
        let lastIndex = 0;
        let match;
        let found = false;
        while ((match = bracketAndUrlRegex.exec(part)) !== null) {
          found = true;
          if (match.index > lastIndex) {
            nextParts.push(part.substring(lastIndex, match.index));
          }
          const linkText = match[1];
          const linkUrl = match[2];
          nextParts.push(
            <a 
              key={`bracket-url-link-${match.index}`} 
              href={linkUrl} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="citation-link"
              style={{ margin: '0 4px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              {linkText}
            </a>
          );
          lastIndex = bracketAndUrlRegex.lastIndex;
        }
        if (lastIndex < part.length || !found) {
          nextParts.push(part.substring(lastIndex));
        }
      }
      parts = nextParts;

      // 2. Standard markdown link: [Text](URL) or 【Text】(URL) -> <a> citation badge
      const linkRegex = /(?:\[|【)([^\]】]+)(?:\]|】)\((https?:\/\/[^\s)]+)\)/g;
      nextParts = [];
      for (const part of parts) {
        if (typeof part !== 'string') {
          nextParts.push(part);
          continue;
        }
        let lastIndex = 0;
        let match;
        let found = false;
        while ((match = linkRegex.exec(part)) !== null) {
          found = true;
          if (match.index > lastIndex) {
            nextParts.push(part.substring(lastIndex, match.index));
          }
          const linkText = match[1];
          const linkUrl = match[2];
          nextParts.push(
            <a 
              key={`link-${match.index}`} 
              href={linkUrl} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="citation-link"
              style={{ margin: '0 4px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              {linkText}
            </a>
          );
          lastIndex = linkRegex.lastIndex;
        }
        if (lastIndex < part.length || !found) {
          nextParts.push(part.substring(lastIndex));
        }
      }
      parts = nextParts;

      // 3. Bracketed raw URL (with optional source: prefix): 【source: URL】 or 【URL】 -> <a> citation badge
      const bracketUrlRegex = /(?:【|\[)(?:source:\s*)?(https?:\/\/[^\s\]】]+)(?:】|\])/gi;
      nextParts = [];
      for (const part of parts) {
        if (typeof part !== 'string') {
          nextParts.push(part);
          continue;
        }
        let lastIndex = 0;
        let match;
        let found = false;
        while ((match = bracketUrlRegex.exec(part)) !== null) {
          found = true;
          if (match.index > lastIndex) {
            nextParts.push(part.substring(lastIndex, match.index));
          }
          const url = match[1];
          const timestamp = parseTime(url);
          nextParts.push(
            <a 
              key={`bracket-url-${match.index}`} 
              href={url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="citation-link"
              style={{ margin: '0 4px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              Video {timestamp ? `@ ${timestamp}` : ''}
            </a>
          );
          lastIndex = bracketUrlRegex.lastIndex;
        }
        if (lastIndex < part.length || !found) {
          nextParts.push(part.substring(lastIndex));
        }
      }
      parts = nextParts;

      // 4. Parentheses bare URL: (URL) -> <a> tag
      const parenUrlRegex = /\((https?:\/\/[^\s)]+)\)/gi;
      nextParts = [];
      for (const part of parts) {
        if (typeof part !== 'string') {
          nextParts.push(part);
          continue;
        }
        let lastIndex = 0;
        let match;
        let found = false;
        while ((match = parenUrlRegex.exec(part)) !== null) {
          found = true;
          if (match.index > lastIndex) {
            nextParts.push(part.substring(lastIndex, match.index));
          }
          const url = match[1];
          const timestamp = parseTime(url);
          nextParts.push(
            <a 
              key={`paren-url-${match.index}`} 
              href={url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="citation-link"
              style={{ margin: '0 4px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              Video {timestamp ? `@ ${timestamp}` : ''}
            </a>
          );
          lastIndex = parenUrlRegex.lastIndex;
        }
        if (lastIndex < part.length || !found) {
          nextParts.push(part.substring(lastIndex));
        }
      }
      parts = nextParts;

      // 4. Bold parsing: **text** -> <strong> tag
      nextParts = [];
      const boldRegex = /\*\*([^*]+)\*\*/g;
      for (const part of parts) {
        if (typeof part !== 'string') {
          nextParts.push(part);
          continue;
        }
        let lastIndex = 0;
        let match;
        let found = false;
        while ((match = boldRegex.exec(part)) !== null) {
          found = true;
          if (match.index > lastIndex) {
            nextParts.push(part.substring(lastIndex, match.index));
          }
          nextParts.push(<strong key={`bold-${match.index}`}>{match[1]}</strong>);
          lastIndex = boldRegex.lastIndex;
        }
        if (lastIndex < part.length || !found) {
          nextParts.push(part.substring(lastIndex));
        }
      }
      parts = nextParts;

      // 5. Inline code parsing: `code` -> <code> tag
      nextParts = [];
      const codeRegex = /`([^`]+)`/g;
      for (const part of parts) {
        if (typeof part !== 'string') {
          nextParts.push(part);
          continue;
        }
        let lastIndex = 0;
        let match;
        let found = false;
        while ((match = codeRegex.exec(part)) !== null) {
          found = true;
          if (match.index > lastIndex) {
            nextParts.push(part.substring(lastIndex, match.index));
          }
          nextParts.push(
            <code 
              key={`code-${match.index}`} 
              style={{ 
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85em', 
                background: 'rgba(0, 0, 0, 0.05)', 
                padding: '2px 6px', 
                borderRadius: '4px',
                color: 'var(--accent-purple)'
              }}
            >
              {match[1]}
            </code>
          );
          lastIndex = codeRegex.lastIndex;
        }
        if (lastIndex < part.length || !found) {
          nextParts.push(part.substring(lastIndex));
        }
      }

      return nextParts;
    };

    const flushList = (key) => {
      if (listItems.length > 0) {
        renderedElements.push(
          <ul key={`list-${key}`} style={{ marginLeft: '20px', marginBottom: '12px', listStyleType: 'disc' }}>
            {listItems}
          </ul>
        );
        listItems = [];
      }
    };

    const flushTable = (key) => {
      if (inTable && tableHeaders.length > 0) {
        renderedElements.push(
          <div key={`table-${key}`} style={{ overflowX: 'auto', margin: '16px 0', borderRadius: '12px', border: '1px solid var(--panel-border)', background: 'rgba(255, 255, 255, 0.45)', boxShadow: '0 4px 12px rgba(0,0,0,0.015)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.92rem' }}>
              <thead>
                <tr style={{ background: 'rgba(124, 58, 237, 0.06)', borderBottom: '1px solid var(--panel-border)' }}>
                  {tableHeaders.map((hdr, hIdx) => (
                    <th key={hIdx} style={{ padding: '12px 16px', fontWeight: '600', color: 'var(--text-primary)' }}>
                      {parseInline(hdr)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, rIdx) => (
                  <tr key={rIdx} style={{ borderBottom: rIdx === tableRows.length - 1 ? 'none' : '1px solid rgba(0, 0, 0, 0.04)', background: rIdx % 2 === 0 ? 'transparent' : 'rgba(0, 0, 0, 0.015)' }}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                        {parseInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        inTable = false;
        tableHeaders = [];
        tableRows = [];
      }
    };

    const isTableRow = (line) => {
      const trimmed = line.trim();
      return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2;
    };

    const isDividerRow = (line) => {
      const trimmed = line.trim();
      return /^\|[\s\:\-\|]+\|$/.test(trimmed);
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const rawLine = lines[idx];
      const trimmedLine = rawLine.trim();

      // Code Block Detection
      if (trimmedLine.startsWith('```')) {
        flushList(idx);
        flushTable(idx);
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLanguage = trimmedLine.substring(3).trim() || 'code';
          codeLines = [];
        } else {
          inCodeBlock = false;
          const codeText = codeLines.join('\n');
          const btnId = `copy-btn-${idx}`;
          renderedElements.push(
            <div 
              key={`code-box-${idx}`} 
              style={{ 
                margin: '16px 0', 
                borderRadius: '12px', 
                overflow: 'hidden', 
                border: '1px solid var(--panel-border)',
                background: '#1e293b', 
                color: '#f8fafc',
                boxShadow: '0 4px 15px rgba(0, 0, 0, 0.05)'
              }}
            >
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '8px 16px', 
                background: '#0f172a', 
                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                fontSize: '0.8rem',
                color: '#94a3b8',
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase'
              }}>
                <span>{codeLanguage}</span>
                <button
                  id={btnId}
                  type="button"
                  onClick={() => handleCopyCode(codeText, btnId)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#f8fafc',
                    padding: '3px 8px',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    fontFamily: 'var(--font-sans)',
                    fontWeight: '600',
                    transition: 'all 0.2s'
                  }}
                >
                  Copy
                </button>
              </div>
              <pre style={{ 
                margin: 0, 
                padding: '16px', 
                overflowX: 'auto', 
                fontFamily: 'var(--font-mono)', 
                fontSize: '0.9rem',
                lineHeight: '1.5',
                color: '#e2e8f0',
                background: '#1e293b'
              }}>
                <code>{codeText}</code>
              </pre>
            </div>
          );
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(rawLine);
        continue;
      }

      // Table Row Detection
      if (isTableRow(rawLine)) {
        flushList(idx);
        const cells = rawLine.split('|').map(c => c.trim()).filter((c, cIdx, arr) => cIdx > 0 && cIdx < arr.length - 1);
        
        if (!inTable) {
          const nextLine = idx + 1 < lines.length ? lines[idx + 1].trim() : '';
          if (isDividerRow(nextLine)) {
            inTable = true;
            tableHeaders = cells;
            tableRows = [];
            idx++; // Skip divider row
          } else {
            renderedElements.push(
              <p key={`p-${idx}`} style={{ marginBottom: '12px' }}>
                {parseInline(rawLine)}
              </p>
            );
          }
        } else {
          if (!isDividerRow(rawLine)) {
            tableRows.push(cells);
          }
        }
        continue;
      } else {
        flushTable(idx);
      }

      // Normal Line Parsing
      if (trimmedLine.startsWith('### ')) {
        flushList(idx);
        renderedElements.push(
          <h3 key={`h3-${idx}`} style={{ fontSize: '1.15rem', fontWeight: '650', color: 'var(--text-primary)', marginTop: '16px', marginBottom: '8px' }}>
            {parseInline(trimmedLine.substring(4))}
          </h3>
        );
      } else if (trimmedLine.startsWith('## ')) {
        flushList(idx);
        renderedElements.push(
          <h2 key={`h2-${idx}`} style={{ fontSize: '1.25rem', fontWeight: '650', color: 'var(--text-primary)', marginTop: '20px', marginBottom: '10px' }}>
            {parseInline(trimmedLine.substring(3))}
          </h2>
        );
      } else if (trimmedLine === '---' || trimmedLine === '***') {
        flushList(idx);
        renderedElements.push(
          <hr key={`hr-${idx}`} style={{ border: 'none', borderTop: '1px solid var(--panel-border)', margin: '18px 0' }} />
        );
      } else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ') || trimmedLine.startsWith('• ')) {
        let content = trimmedLine;
        if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
          content = trimmedLine.substring(2);
        } else if (trimmedLine.startsWith('• ')) {
          content = trimmedLine.substring(2);
        } else if (trimmedLine.startsWith('•')) {
          content = trimmedLine.substring(1).trim();
        }
        listItems.push(
          <li key={`li-${idx}`} style={{ marginBottom: '6px' }}>
            {parseInline(content)}
          </li>
        );
      } else if (trimmedLine.startsWith('>') && trimmedLine.length > 1) {
        flushList(idx);
        const content = trimmedLine.substring(1).trim();
        renderedElements.push(
          <blockquote 
            key={`quote-${idx}`} 
            style={{ 
              borderLeft: '4px solid var(--accent-purple)', 
              paddingLeft: '16px', 
              color: 'var(--text-secondary)', 
              margin: '12px 0', 
              fontStyle: 'italic' 
            }}
          >
            {parseInline(content)}
          </blockquote>
        );
      } else {
        const numListRegex = /^(\d+)\s*[\.\)]\s*(.*)$/;
        const numListMatch = trimmedLine.match(numListRegex);
        if (numListMatch) {
          flushList(idx);
          const num = numListMatch[1];
          const content = numListMatch[2];
          renderedElements.push(
            <div key={`num-${idx}`} style={{ display: 'flex', gap: '8px', marginBottom: '8px', paddingLeft: '8px' }}>
              <span style={{ fontWeight: '600', color: 'var(--accent-purple)', minWidth: '18px' }}>{num}.</span>
              <div style={{ flex: 1 }}>{parseInline(content)}</div>
            </div>
          );
        } else {
          flushList(idx);
          if (trimmedLine === '') {
            renderedElements.push(<div key={`space-${idx}`} style={{ height: '8px' }} />);
          } else {
            renderedElements.push(
              <p key={`p-${idx}`} style={{ marginBottom: '12px' }}>
                {parseInline(rawLine)}
              </p>
            );
          }
        }
      }
    }

    flushList(lines.length);
    flushTable(lines.length);
    return renderedElements;
  };

  // Format seconds to hh:mm:ss or mm:ss
  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <div className="ambient-glow"></div>
      <div className="ambient-glow-2"></div>

      <div className="bento-container">
        {/* Header Cell */}
        <header className="glass-panel cell-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path>
              <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="#a855f7"></polygon>
            </svg>
            <div>
              <h1>YouTube RAG</h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>AI-Powered Semantic Video Search & Question Answering</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span className="status-badge status-ready" style={{ padding: '6px 12px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-green)', display: 'inline-block' }}></span>
              Server Online
            </span>
          </div>
        </header>

        {/* Ingestion Form Cell */}
        <section className="glass-panel cell-ingestion">
          <h2>Ingest Content</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>Add new YouTube videos or full playlists into the semantic database.</p>
          
          <div className="toggle-group">
            <button 
              type="button" 
              className={`toggle-btn ${ingestType === 'video' ? 'active' : ''}`}
              onClick={() => setIngestType('video')}
            >
              Single Video
            </button>
            <button 
              type="button" 
              className={`toggle-btn ${ingestType === 'playlist' ? 'active' : ''}`}
              onClick={() => setIngestType('playlist')}
            >
              Playlist
            </button>
          </div>

          <form onSubmit={handleIngest}>
            <div className="input-wrapper">
              <input
                type="text"
                placeholder={ingestType === 'video' 
                  ? "https://www.youtube.com/watch?v=..." 
                  : "https://www.youtube.com/playlist?list=..."}
                value={ingestUrl}
                onChange={(e) => setIngestUrl(e.target.value)}
                className="text-input"
                disabled={isIngesting}
              />
            </div>
            <button 
              type="submit" 
              className="btn-primary" 
              style={{ marginTop: '16px' }}
              disabled={isIngesting || !ingestUrl.trim()}
            >
              {isIngesting ? (
                <>
                  <div className="spinner"></div> Ingesting...
                </>
              ) : (
                'Start Ingestion'
              )}
            </button>
          </form>

          {ingestMessage.text && (
            <div 
              style={{
                marginTop: '16px',
                padding: '12px 16px',
                borderRadius: '10px',
                fontSize: '0.88rem',
                border: '1px solid',
                background: ingestMessage.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                borderColor: ingestMessage.type === 'success' ? 'var(--accent-green)' : '#ef4444',
                color: ingestMessage.type === 'success' ? '#34d399' : '#f87171',
              }}
            >
              {ingestMessage.text}
            </div>
          )}
        </section>

        {/* Video Grid Cell */}
        <section className="glass-panel cell-videos">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div>
              <h2>Ingested Videos</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {selectedVideoIds.length > 0 
                  ? `Query scoped to ${selectedVideoIds.length} selected video(s)` 
                  : 'Searching across all videos'}
              </p>
            </div>
            <button 
              type="button"
              onClick={fetchVideos}
              className="select-spatial"
              style={{ padding: '6px 12px', background: 'transparent' }}
            >
              Refresh
            </button>
          </div>

          {videos.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--text-muted)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '12px' }}>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              No videos ingested yet.
            </div>
          ) : (
            <div className="video-grid">
              {videos.map((vid) => (
                <div 
                  key={vid.video_id}
                  onClick={() => toggleVideoSelect(vid.video_id)}
                  className={`video-card ${selectedVideoIds.includes(vid.video_id) ? 'selected' : ''}`}
                  style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '14px', padding: '12px', position: 'relative' }}
                >
                  <button
                    type="button"
                    onClick={(e) => handleDeleteVideo(e, vid.video_id)}
                    style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      color: '#ef4444',
                      borderRadius: '50%',
                      width: '20px',
                      height: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 'bold',
                      zIndex: 10,
                      transition: 'all 0.2s',
                    }}
                    title="Delete video"
                  >
                    &times;
                  </button>

                  {/* Generated CSS Video Thumbnail */}
                  <div style={{
                    width: '80px',
                    height: '46px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
                    position: 'relative',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.08)',
                    overflow: 'hidden'
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    
                    <div style={{
                      position: 'absolute',
                      bottom: '2px',
                      right: '2px',
                      background: 'rgba(0, 0, 0, 0.8)',
                      color: 'white',
                      fontSize: '0.65rem',
                      fontWeight: 'bold',
                      padding: '1px 3px',
                      borderRadius: '3px',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      {formatDuration(vid.duration_seconds)}
                    </div>
                  </div>

                  {/* Video Metadata */}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div className="video-title" title={vid.title} style={{ paddingRight: '16px' }}>
                      {vid.title || 'Processing Title...'}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                        {vid.channel || 'Channel Unknown'}
                      </div>
                      <span className={`status-badge status-${vid.status}`}>
                        {vid.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Chat Interface Cell */}
        <section className="glass-panel cell-chat">
          <div className="chat-layout">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px' }}>
              <h2>AI Assistant</h2>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <div className="language-selector">
                  <span>Language:</span>
                  <select 
                    value={answerLanguage}
                    onChange={(e) => setAnswerLanguage(e.target.value)}
                    className="select-spatial"
                  >
                    <option value="auto">Auto (Match Question)</option>
                    <option value="english">English</option>
                    <option value="hindi">Hindi (हिन्दी)</option>
                    <option value="hinglish">Hinglish</option>
                  </select>
                </div>
                <button 
                  type="button" 
                  className="select-spatial"
                  style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}
                  onClick={() => setMessages([
                    { sender: 'bot', text: 'Chat cleared. Ask me any question!' }
                  ])}
                >
                  Clear Chat
                </button>
              </div>
            </div>

            <div className="chat-history" ref={chatHistoryRef}>
              {messages.map((msg, index) => (
                <div key={index} className={`chat-bubble ${msg.sender}`}>
                  {msg.sender === 'bot' ? (
                    <div>{renderMarkdown(msg.text)}</div>
                  ) : (
                    msg.text
                  )}
                </div>
              ))}
              {isAnswering && (
                <div className="chat-bubble bot">
                  <div className="typing-indicator">
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleAsk} className="chat-input-wrapper">
              <input
                type="text"
                placeholder={selectedVideoIds.length > 0
                  ? `Ask a question scoped to ${selectedVideoIds.length} video(s)...`
                  : "Ask a question across all ingested videos..."}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="text-input"
                style={{ flex: 1 }}
                disabled={isAnswering}
              />
              <button 
                type="submit" 
                className="btn-primary" 
                style={{ width: 'auto', paddingLeft: '24px', paddingRight: '24px' }}
                disabled={isAnswering || !chatInput.trim()}
              >
                Send
              </button>
            </form>
          </div>
        </section>
      </div>
    </>
  );
}

export default App;
