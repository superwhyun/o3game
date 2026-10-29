const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const base = process.env.FLEET_TEST_MONGODB_URI;
const uri = base?.replace(/\/[^/?]+(?=\?|$)/, '/cosmic_improvements_test');

test('improvements persist, paginate and enforce admin deletion', { skip: !uri }, async () => {
  process.env.JWT_SECRET = 'improvements-test-only-secret-at-least-32-characters';
  await mongoose.connect(uri);
  let server;
  try {
    await mongoose.connection.dropDatabase();
    const User = require('../models/User');
    const Request = require('../models/ImprovementRequest');
    const user = await User.create({ username: 'suggestion_user', email: 'user@example.test', password: 'test-password' });
    const admin = await User.create({ username: 'suggestion_admin', email: 'admin@example.test', password: 'test-password', isAdmin: true });
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/requests', require('../routes/improvementRequests'));
    server = app.listen(0);
    await new Promise(resolve => server.on('listening', resolve));
    const jwt = require('jsonwebtoken');
    const request = async (actor, method = 'GET', path = '', body) => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/requests${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: 'Bearer ' + jwt.sign({ userId: actor._id }, process.env.JWT_SECRET) } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      return { status: res.status, data: await res.json() };
    };
    assert.equal((await request(null)).status, 401);
    assert.equal((await request(null, 'POST', '', { title: 'x', description: 'y' })).status, 401);
    for (const body of [{ title: ' ', description: 'x' }, { title: 'x', description: [] }, { title: 'x'.repeat(101), description: 'x' }, { title: 'x', description: 'x'.repeat(2001) }]) {
      assert.equal((await request(user, 'POST', '', body)).status, 400);
    }
    const created = await request(user, 'POST', '', { title: '  작은 화면 개선  ', description: '  <script>문자 그대로</script>  ', authorName: 'forged', authorType:'ai' });
    assert.equal(created.status, 201);
    assert.equal(created.data.request.title, '작은 화면 개선');
    assert.equal(created.data.request.authorName, user.username);
    assert.equal(created.data.request.authorType, "human");
    assert.equal(created.data.request.authorUserId, undefined);
    const id = created.data.request._id;
    const review = { decision: 'partial', reviewNote: '저장고 안내 반영. 기본 용량 상향은 제외.' };
    assert.equal((await request(user, 'PATCH', `/${id}/review`, review)).status, 403);
    for (const body of [{ decision: 'bad', reviewNote: 'x' }, { decision: 'partial', reviewNote: ' ' }, { decision: 'rejected', reviewNote: 'x'.repeat(2001) }])
      assert.equal((await request(admin, 'PATCH', `/${id}/review`, body)).status, 400);
    const reviewed = await request(admin, 'PATCH', `/${id}/review`, review);
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.data.request.reviewStatus, 'reviewed');
    assert.equal(reviewed.data.request.reviewerName, admin.username);
    assert.equal(reviewed.data.request.reviewNote, review.reviewNote);
    assert.equal((await request(user)).data.requests[0].decision, 'partial');
    for (const status of ['partial', 'reviewed']) {
      const filtered = await request(user, 'GET', '?status=' + status);
      assert.equal(filtered.status, 200);
      assert.equal(filtered.data.requests.length, 1);
    }
    for (const status of ['implemented', 'rejected', 'pending'])
      assert.equal((await request(user, 'GET', '?status=' + status)).data.requests.length, 0);
    assert.equal((await request(user, 'GET', '?status=invalid')).status, 400);
    assert.equal((await request(admin, 'PATCH', '/000000000000000000000000/review', review)).status, 404);
    assert.equal((await request(user, 'DELETE', '/' + id)).status, 403);
    assert.equal(await Request.countDocuments(), 1);
    assert.equal((await request(admin)).data.requests[0]._id, id);
    await Request.insertMany(Array.from({ length: 55 }, (_, i) => ({ authorUserId: user._id, authorName: user.username, title: `제안 ${i}`, description: '내용' })));
    const first = (await request(user)).data;
    const second = (await request(user, 'GET', '?before=' + first.nextCursor)).data;
    const pendingFirst = (await request(user, 'GET', '?status=pending')).data;
    const pendingSecond = (await request(user, 'GET', '?status=pending&before=' + pendingFirst.nextCursor)).data;
    assert.equal(pendingFirst.requests.length, 50);
    assert.equal(pendingSecond.requests.length, 5);
    assert.ok([...pendingFirst.requests, ...pendingSecond.requests].every(item => item.reviewStatus === 'pending'));
    assert.equal((await request(user, 'GET', '?status=partial')).data.requests[0]._id, id);
    assert.equal(first.requests.length, 50);
    assert.equal(second.requests.length, 6);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.requests, ...second.requests].map(item => item._id)).size, 56);
    assert.equal((await request(user, 'GET', '?before=invalid')).status, 400);
    assert.equal((await request(admin, 'DELETE', '/invalid')).status, 400);
    assert.equal((await request(admin, 'DELETE', '/' + id)).status, 200);
    assert.equal((await request(admin, 'DELETE', '/' + id)).status, 404);
    assert.equal(await Request.countDocuments(), 55);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
