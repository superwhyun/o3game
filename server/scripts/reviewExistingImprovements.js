// This is a fixed review batch, not a rule for future requests. Preview by default.
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const Request = require('../models/ImprovementRequest');
const reviews = [
  ['6ac756ad054b05f1cb9553db', 'partial', '반영: 저장 한도 도달 시 추가 생산분이 저장되지 않는 안내와 해당 저장고 건설 바로가기를 추가했습니다. 제외: 무료 저장고 지급과 기본 저장 용량 상향은 적용하지 않았습니다. 저장고 확장에 필요한 자원 배분은 유지합니다.'],
  ['6ac74728054b05f1cb9548af', 'rejected', '현재 서버는 에너지 적자가 자원 생산을 감소시키도록 계산하지 않으므로, 제시한 에너지 악순환을 근거로 무료 발전소를 지급하지는 않습니다. 별도로 개척 화면에 추천 자원 적재와 무자원 출격 안내를 추가해 초기 건설 준비를 돕습니다.'],
  ['6ac743061b7a16148e8a98d8', 'partial', '반영: 인구 탑승 공간과 보유 자원을 고려한 추천 적재, 무자원 출격 안내, 최신 정찰 지형·면적 미리보기와 정찰 바로가기를 추가했습니다. 식민선 1척 소모와 인구·자원·함대 정착을 안내합니다. 제외: 미정찰 행성의 지형을 공개하지 않습니다. 현재 실제 출격 연료 차감은 없습니다.'],
  ['6ac742561b7a16148e8a947e', 'partial', '반영: 기존·신규 행성의 추가 가용면적 기본값 40칸과 관리자 조절 기능, 남은 면적 경고, 테라포밍 증가 면적·비용·부족한 선행조건 및 연구 바로가기를 제공했습니다. 에너지 생산·소비·잔여량 표시도 수정했습니다. 제외: 레벨당 1칸 소모와 테라포밍 선행조건·비용은 유지합니다.'],
  ['6ac7351f1b7a16148e8a58a2', 'rejected', '현재 서버에는 에너지 적자에 따른 자원 생산 감소 계산이 없어 제시한 악순환의 전제가 현재 동작과 다릅니다. 실제 생산·소비·잔여량 표시를 수정했습니다. 발전소 대폭 강화, 효율 연구 추가, 모듈형 업그레이드는 이번 변경에서 제외합니다.'],
  ['6ac65bb0113057f9ada4a3fb', 'rejected', '시작 함선 지급과 함선 건조 선행조건 완화는 이번 변경에 포함하지 않습니다. 현재 관리자 게임 속도와 사용자 공통 연구를 고려해 신규 계정의 첫 함선 확보 시간을 측정한 뒤 별도 검토할 항목입니다.'],
  ['6ac65951113057f9ada4a37d', 'rejected', '중수소 생산량, 신규 사용자 시작 자원 및 엔진 연구 비용의 일괄 상향·하향은 적용하지 않습니다. 초기 진행 시간과 실제 자원 병목을 측정한 뒤 별도 검토할 항목입니다.'],
  ['6ac65945113057f9ada4a37b', 'rejected', '태양광 생산 배율과 광산 소비량 변경 및 신규 효율 연구는 적용하지 않습니다. 먼저 실제 에너지 생산·소비·잔여량을 정확히 표시하도록 수정했습니다. 에너지 적자가 현재 자원 생산을 감소시키지는 않습니다.']
];
(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const ids = reviews.map(([id]) => id);
    const rows = await Request.find({ _id: { $in: ids } }).select('title reviewStatus decision').lean();
    if (rows.length !== reviews.length) throw new Error('The fixed review batch does not match this database');
    console.log(JSON.stringify({ apply: process.argv.includes('--apply'), requests: rows.map(row => ({ id: String(row._id), title: row.title, previousStatus: row.reviewStatus || 'pending', decision: reviews.find(([id]) => id === String(row._id))[1] })) }));
    if (process.argv.includes('--apply')) {
      const reviewedAt = new Date();
      const result = await Request.bulkWrite(reviews.map(([id, decision, reviewNote]) => ({ updateOne: { filter: { _id: id, reviewStatus: { $ne: 'reviewed' } }, update: { $set: { reviewStatus: 'reviewed', decision, reviewNote, reviewedAt, reviewedBy: null, reviewerName: '운영 검토' } } } })));
      console.log(JSON.stringify({ reviewed: result.modifiedCount, alreadyReviewed: reviews.length - result.modifiedCount }));
    }
  } finally { await mongoose.disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
