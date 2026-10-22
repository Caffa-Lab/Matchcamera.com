"""Manually verify curated used-sale HTML pages; preview unless --write is given."""
import argparse
import copy
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
import hashlib
import json
from pathlib import Path
import re
import time
import unicodedata
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.robotparser import RobotFileParser

DATA_PATH = Path(__file__).resolve().parents[1] / 'public/data/used-prices.json'
HOSTS = {'canon-store.com', 'kookmincamera.co.kr'}
USER_AGENT = 'Matchcamera-used-price-review/1.0'
MAX_BYTES = 8 * 1024 * 1024


def checked_url(value):
    url = urlsplit(value)
    query = parse_qs(url.query, strict_parsing=True)
    if (url.scheme != 'https' or url.hostname not in HOSTS or url.username or
            url.password or url.port is not None or url.fragment or
            url.path != '/product/detail.html' or set(query) != {'product_no'} or
            len(query['product_no']) != 1 or not query['product_no'][0].isdigit()):
        raise ValueError('검토한 판매처의 개별 상품 URL만 확인할 수 있습니다.')
    return url


class ProductHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.scripts, self.script, self.price, self.depth = [], None, [], 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if self.depth and tag not in {'input', 'img', 'br', 'hr', 'meta', 'link'}:
            self.depth += 1
        if attrs.get('id') == 'span_product_price_text':
            self.depth = 1
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self.script = []

    def handle_data(self, data):
        if self.script is not None:
            self.script.append(data)
        if self.depth:
            self.price.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.script is not None:
            self.scripts.append(''.join(self.script))
            self.script = None
        if self.depth:
            self.depth -= 1


def title_key(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())


def parse_offer(html, expected_title):
    page = ProductHTML()
    page.feed(html)
    records = []
    for script in page.scripts:
        value = json.loads(script)
        records.extend(value if isinstance(value, list) else value.get('@graph', [value]))
    products = [p for p in records if isinstance(p, dict) and p.get('@type') == 'Product'
                and isinstance(p.get('name'), str) and title_key(p['name']) == title_key(expected_title)]
    if len(products) != 1:
        raise ValueError('기존 모델·상태 제목과 일치하는 상품을 확인하지 못했습니다.')
    offer = products[0].get('offers')
    if isinstance(offer, list) and len(offer) == 1:
        offer = offer[0]
    if not isinstance(offer, dict) or offer.get('priceCurrency') != 'KRW':
        raise ValueError('단일 원화 판매 가격을 확인하지 못했습니다.')
    if isinstance(offer.get('price'), bool):
        raise ValueError('올바르지 않은 가격입니다.')
    try:
        price = Decimal(str(offer.get('price')))
        valid_price = price.is_finite() and 0 < price <= 1_000_000_000 and price == price.to_integral_value()
    except InvalidOperation:
        valid_price = False
    visible = ''.join(page.price).strip()
    if not valid_price or not re.fullmatch(r'(?:[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)\s*원', visible):
        raise ValueError('확인할 수 있는 양수 판매 가격이 아닙니다.')
    if int(price) != int(re.sub(r'[^0-9]', '', visible)):
        raise ValueError('화면 판매가와 구조화된 가격이 일치하지 않습니다.')
    option = re.search(r"\bvar\s+has_option\s*=\s*['\"]([FT])['\"]", html)
    sold = re.search(r"\bvar\s+is_soldout_icon\s*=\s*['\"]([FT])['\"]", html)
    if not option or option[1] != 'F':
        raise ValueError('옵션이 추가되었거나 단품 가격을 확인할 수 없습니다.')
    if not sold:
        raise ValueError('판매 상태를 확인하지 못했습니다.')
    state = offer.get('availability', '').removeprefix('https://schema.org/').removeprefix('http://schema.org/')
    if state not in {'InStock', 'OutOfStock'}:
        raise ValueError('판매처의 재고 표기를 확인하지 못했습니다.')
    # Unmanaged stock_number=0 does not mean sold out. Use the published state.
    availability = 'sold-out' if sold[1] == 'T' or state == 'OutOfStock' else 'in-stock'
    result = {'priceKrw': int(price), 'availability': availability}
    if availability == 'sold-out':
        # A stock/sold-out icon is not evidence that somebody actually bought
        # this item. Keep that uncertainty explicit in both current and history.
        result['completionStatus'] = 'out-of-stock'
    return result


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('상품 주소가 이동했습니다. 원본 URL을 다시 검토해 주세요.')


class PublicHTMLReader:
    def __init__(self):
        self.robots, self.last_request = {}, {}
        self.opener = build_opener(NoRedirect())

    def get(self, url, delay=1):
        host = urlsplit(url).hostname
        time.sleep(max(0, delay - (time.monotonic() - self.last_request.get(host, 0))))
        try:
            with self.opener.open(Request(url, headers={'User-Agent': USER_AGENT}), timeout=20) as response:
                raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise ValueError('페이지 크기 제한을 초과했습니다.')
                return raw.decode(response.headers.get_content_charset() or 'utf-8', errors='strict')
        finally:
            self.last_request[host] = time.monotonic()

    def __call__(self, url):
        parsed = checked_url(url)
        if parsed.hostname not in self.robots:
            # Cache failures too: a blocked/unreachable robots file must not be
            # retried for every offer from the same seller in this review run.
            self.robots[parsed.hostname] = None
            robot = RobotFileParser()
            try:
                robot.parse(self.get(f'https://{parsed.hostname}/robots.txt').splitlines())
            except HTTPError as error:
                if error.code != 404:
                    raise
                robot.parse([])
            self.robots[parsed.hostname] = robot
        robot = self.robots[parsed.hostname]
        if robot is None:
            raise ValueError('판매처 robots.txt를 확인하지 못해 이 판매처의 갱신을 보류합니다.')
        if not robot.can_fetch(USER_AGENT, url):
            raise ValueError('판매처 robots.txt에서 이 상품 경로의 접근을 허용하지 않습니다.')
        return self.get(url, max(1, robot.crawl_delay(USER_AGENT) or 1))


def refresh_offers(dataset, fetch_html, checked_at):
    updated, results = copy.deepcopy(dataset), []
    if not isinstance(checked_at, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', checked_at):
        raise ValueError('가격 확인일은 YYYY-MM-DD 형식이어야 합니다.')
    datetime.strptime(checked_at, '%Y-%m-%d')
    observations = updated.get('observations', [])
    if not isinstance(observations, list) or any(not isinstance(item, dict) for item in observations):
        raise ValueError('저장된 가격 관측 기록의 형식을 확인해 주세요.')
    for offer in updated['offers']:
        try:
            checked_url(offer['sourceUrl'])
            if offer.get('verified') is not True or offer.get('kind') != 'used-sale':
                raise ValueError('검토된 중고 판매 호가만 갱신할 수 있습니다.')
            if any(not isinstance(offer.get(key), str) or not offer[key].strip() for key in ['id', 'productId']):
                raise ValueError('가격 관측 기록에 필요한 상품 식별자가 없습니다.')
            html = fetch_html(offer['sourceUrl'])
            change = parse_offer(html, offer['title'])
            # Build the full verified record before changing the snapshot. A
            # failed read must not manufacture a fresh check date or graph point.
            refreshed = {**offer, **change, 'checkedAt': checked_at}
            if change['availability'] == 'sold-out':
                refreshed['completionCheckedAt'] = checked_at
            else:
                refreshed.pop('completionStatus', None)
                refreshed.pop('completionCheckedAt', None)
                refreshed.pop('completionEvidence', None)
            evidence = offer.get('evidence') if isinstance(offer.get('evidence'), dict) else {}
            refreshed['evidence'] = {**evidence, 'contentSha256': hashlib.sha256(html.encode('utf-8')).hexdigest(),
                                     'availabilityBasis': '판매처 품절 표기' if change['availability'] == 'sold-out' else '판매처 판매 중 표기 · 실재고는 판매처 확인'}
            observation = {key: refreshed[key] for key in ['productId', 'sourceUrl', 'priceKrw', 'availability']}
            observation.update(offerId=refreshed['id'], observedOn=checked_at)
            if change['availability'] == 'sold-out':
                observation['completionStatus'] = change['completionStatus']
            # Re-checking an item today replaces today's observation only; an
            # earlier day's price/state remains the evidence for that day.
            observations = [item for item in observations if not (
                item.get('offerId') == refreshed['id'] and item.get('observedOn') == checked_at)]
            observations.append(observation)
            updated['observations'] = observations
            offer.clear()
            offer.update(refreshed)
            results.append({'id': offer['id'], 'ok': True, **change})
        except Exception as error:
            results.append({'id': offer.get('id', '?'), 'ok': False, 'error': str(error)})
    if any(row['ok'] for row in results):
        updated['updatedAt'] = checked_at
    return updated, results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='성공적으로 확인한 기존 호가만 저장')
    args = parser.parse_args()
    data = json.loads(DATA_PATH.read_text(encoding='utf-8'))
    if data.get('schemaVersion') != 1 or data.get('currency') != 'KRW' or not isinstance(data.get('offers'), list):
        raise ValueError('중고가 자료의 형식을 확인해 주세요.')
    today = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
    updated, results = refresh_offers(data, PublicHTMLReader(), today)
    print(json.dumps({'mode': 'write' if args.write else 'preview', 'results': results}, ensure_ascii=False, indent=2))
    if args.write and any(row['ok'] for row in results):
        temporary = DATA_PATH.with_suffix('.json.tmp')
        try:
            temporary.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            temporary.replace(DATA_PATH)
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
