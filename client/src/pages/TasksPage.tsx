import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../utils/api";
import "./PageStyles.css";

interface Task {
  id: string;
  name: string;
  cron: string;
  command: string;
  enabled: boolean;
  lastRun?: string;
  lastResult?: string;
  createdAt: string;
}

interface ActiveAgent {
  status: string;
  tool?: string;
  title: string;
  startedAt: string;
}

const CRON_PRESETS = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day at midnight", value: "0 0 * * *" },
  { label: "Every Monday", value: "0 0 * * 1" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeAgents, setActiveAgents] = useState<Record<string, ActiveAgent>>({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", cron: "0 * * * *", command: "" });
  const navigate = useNavigate();

  const refreshAgents = useCallback(() => {
    api.getActiveAgents().then(setActiveAgents);
  }, []);

  useEffect(() => {
    api.getTasks().then(setTasks);
    refreshAgents();
    const interval = setInterval(refreshAgents, 2000);
    return () => clearInterval(interval);
  }, [refreshAgents]);

  const killAgent = async (sessionId: string) => {
    await api.killAgent(sessionId);
    setActiveAgents((prev) => { const next = { ...prev }; delete next[sessionId]; return next; });
  };

  const openChat = (sessionId: string) => {
    navigate(`/?session=${sessionId}`);
  };

  const createTask = async () => {
    const task = await api.createTask(form);
    setTasks((prev) => [...prev, task]);
    setShowForm(false);
    setForm({ name: "", cron: "0 * * * *", command: "" });
  };

  const toggleTask = async (task: Task) => {
    const updated = await api.updateTask(task.id, { enabled: !task.enabled });
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
  };

  const deleteTask = async (id: string) => {
    await api.deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const agentEntries = Object.entries(activeAgents);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Tasks</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>New task</button>
      </div>

      {agentEntries.length > 0 && (
        <section className="active-agents-section">
          <h2 className="section-title">Active Agent Tasks</h2>
          <div className="card-list">
            {agentEntries.map(([sessionId, agent]) => (
              <div key={sessionId} className="card active-agent-card">
                <div className="card-header">
                  <div className="card-title-row">
                    <span className="agent-pulse-dot" />
                    <h3 className="active-agent-title">{agent.title}</h3>
                    <span className="status-badge active">{agent.status === "tool_call" || agent.status === "tool_result" ? agent.tool || agent.status : agent.status}</span>
                  </div>
                  <div className="card-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => openChat(sessionId)}>Open chat</button>
                    <button className="btn btn-danger btn-sm" onClick={() => killAgent(sessionId)}>Kill</button>
                  </div>
                </div>
                <div className="card-body">
                  <div className="card-detail"><strong>Started:</strong> {new Date(agent.startedAt).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title">Scheduled Tasks</h2>

      {showForm && (
        <div className="card form-card">
          <h3>Create Task</h3>
          <div className="form-group">
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Task name" />
          </div>
          <div className="form-group">
            <label>Schedule (cron)</label>
            <input value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} placeholder="* * * * *" />
            <div className="preset-chips">
              {CRON_PRESETS.map((p) => (
                <button key={p.value} className="chip" onClick={() => setForm({ ...form, cron: p.value })}>{p.label}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>Command</label>
            <textarea value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="python3 script.py" rows={3} />
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={createTask}>Create</button>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card-list">
        {tasks.map((task) => (
          <div key={task.id} className="card">
            <div className="card-header">
              <div className="card-title-row">
                <h3>{task.name}</h3>
                <span className={`status-badge ${task.enabled ? "active" : "inactive"}`}>
                  {task.enabled ? "Active" : "Paused"}
                </span>
              </div>
              <div className="card-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => toggleTask(task)}>
                  {task.enabled ? "Pause" : "Resume"}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => deleteTask(task.id)}>Delete</button>
              </div>
            </div>
            <div className="card-body">
              <div className="card-detail"><strong>Schedule:</strong> <code>{task.cron}</code></div>
              <div className="card-detail"><strong>Command:</strong> <code>{task.command}</code></div>
              {task.lastRun && <div className="card-detail"><strong>Last run:</strong> {new Date(task.lastRun).toLocaleString()}</div>}
              {task.lastResult && <pre className="card-result">{task.lastResult}</pre>}
            </div>
          </div>
        ))}
        {tasks.length === 0 && !showForm && (
          <div className="empty-state-full">
            <p>No scheduled tasks yet</p>
            <p className="hint">Create a cron job to automate recurring tasks</p>
          </div>
        )}
      </div>
      </section>
    </div>
  );
}
