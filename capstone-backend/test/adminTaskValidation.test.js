'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboard = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'Admin', 'AdminDashboard.js'),
  'utf8'
);

test('admin task add button submits an empty field so validation is visible', () => {
  assert.match(dashboard, /if \(!trimmed\)\s*{[\s\S]*setNewTodoError\("Task cannot be empty\./);
  assert.match(dashboard, /<form onSubmit={handleAddTodo}[\s\S]*<button type="submit" className="todo-add-btn"/);
  assert.doesNotMatch(dashboard, /className="todo-add-btn"[^>]*disabled={!String\(newTodo/);
});

test('admin task validation is announced and linked to its input', () => {
  assert.match(dashboard, /id="todo-input-error"\s+role="alert"/);
  assert.match(dashboard, /aria-describedby={newTodoError \? "todo-input-error" : undefined}/);
  assert.match(dashboard, /aria-label="Add task"/);
});
