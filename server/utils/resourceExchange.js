const EXCHANGE = Object.freeze({ rates: Object.freeze({ metal: 3, crystal: 2, deuterium: 1, food: 2 }), fee: 0.05 });
function exchangeQuote({ from, to, amount } = {}) {
  if (!Object.hasOwn(EXCHANGE.rates, from) || !Object.hasOwn(EXCHANGE.rates, to) || from === to) {
    throw Object.assign(new Error('서로 다른 교환 자원을 선택해 주세요.'), { statusCode: 400 });
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Object.assign(new Error('교환 수량은 양의 정수여야 합니다.'), { statusCode: 400 });
  const received = Math.floor(amount / EXCHANGE.rates[from] * EXCHANGE.rates[to] * (1 - EXCHANGE.fee));
  if (!Number.isSafeInteger(received) || received < 1) throw Object.assign(new Error('받을 자원이 1 이상이 되도록 수량을 입력해 주세요.'), { statusCode: 400 });
  return { from, to, amount, received };
}
function applyExchange(planet, storage, input) {
  const quote = exchangeQuote(input);
  if ((planet.resources[quote.from] || 0) < quote.amount) throw Object.assign(new Error('교환할 자원이 부족합니다.'), { statusCode: 400 });
  if ((planet.resources[quote.to] || 0) + quote.received > storage[quote.to]) throw Object.assign(new Error('받을 자원의 저장 공간이 부족합니다.'), { statusCode: 400 });
  planet.resources[quote.from] -= quote.amount;
  planet.resources[quote.to] = (planet.resources[quote.to] || 0) + quote.received;
  return quote;
}
module.exports = { EXCHANGE, exchangeQuote, applyExchange };
