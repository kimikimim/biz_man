/* =====================================================================
   simulator.js — 5차년도 2분기 의사결정 시뮬레이터
   ---------------------------------------------------------------------
   · 비용 공식은 5차년도 1분기 결과 보고서(A3·A5)로 맞춤 — 영업직원 급여,
     판촉비, 광고비, 물류비, 교육훈련비, 노무비, 매출 현금회수율(60%)은
     1분기 실제값과 원 단위까지 일치함
   · 수요는 "1분기 실제 판매량 × 경기 변화 × 내 결정 변화의 영향"으로 추정
     (경쟁사는 1분기 결정을 유지한다고 가정) — 탄력성 등은 '가정' 패널에서 조정
   · 대시보드의 RATIO_SPEC · ratioValue · fmtRatio · fmtEok · esc 를 함께 씀
   ===================================================================== */
(function () {
    const C = ['KR', 'US', 'CN'];
    const CN_NAME = { KR: '한국', US: '미국', CN: '중국' };
    const CUR = { KR: '원', US: '달러', CN: '위안' };

    // ---------------- 5차년도 1분기 말 기준값 (biz-manager 자사 성과 보고서) ----------------
    const SIM = {
        fx: { KR: 1, US: 1121.2, CN: 163.19 },                         // 5차년도 2분기 환율 예측 (C. 경제 동향)
        gdp: { KR: 102.36 / 102.6, US: 103.35 / 102.3, CN: 101.37 / 107.1 },   // 실질 GDP 2Q 예측 ÷ 1Q 실적
        base: {                                                         // 1분기 실제 결정·판매 (수요 기준점)
            sales: { KR: 70015, US: 26812, CN: 60928 },
            price: { KR: 999900, US: 799, CN: 5800 },
            ad: { KR: 4e9, US: 1e6, CN: 2e7 },
            promo: { KR: 140e6, US: 20000, CN: 800000 },
            stores: { KR: 65, US: 44, CN: 73 },
            active: { KR: 211, US: 170, CN: 218 },
            model: 5
        },
        begin: {
            inv: { KR: 65745, US: 23188, CN: 72863 }, invValue: 61895165606,
            ar: 96163663474, shortDebt: 5559130716, bond: 70e9, equity: 109210350364,
            securities: 3982800000, nonCurrent: 22727852000,
            staff: { KR: 211, US: 170, CN: 218 }, stores: { KR: 65, US: 44, CN: 73 }
        },
        lineRate: { KR: 23220, CN: 16724 },                             // 라인당 48시간 생산량 (1분기 실적 ÷ 8)
        material: {                                                     // A3-3 모델별 부품 재료비
            KR: { 4: 211800, 5: 238275, 6: 270045, 7: 307110, 8: 333585, 9: 365355, 10: 436308 },
            CN: { 4: 1020, 5: 1173, 6: 1224, 7: 1408, 8: 1683, 9: 1836, 10: 2097 }
        },
        urgentPremium: { KR: 1.5, CN: 1.63 },                           // 긴급구매 단가 ÷ 정상 단가 (1분기 실측)
        utilityPerLine: { KR: 317700000, CN: 229320000 },
        fixedOverhead: { KR: 400000000 + 802400000 + 4236000000, CN: 209883600 + 699612000 + 882000000 },
        logistics: { KR: 10590, US: 52950, CN: 10500 },                 // 개당 (한국→한국, 한국→미국, 중국→중국)
        invCostPerUnit: 37794, storeUpkeep: 56105696,
        fixedSGA: { hq: 5590792200, office: 1458629000, rent: 1059000000, other: 1183768020 },
        depreciation: 2111895600, bondRateQ: 3131168735 / 70e9,
        actual1Q: { 판매량: 157755, 매출액: 240409158684, 영업이익: -14769878721, 당기순이익: -17745447456, 기말재고: 161796, 영업CF: 35278348413, 긴급자금: 5559130716 }
    };

    // ---------------- 가정 (화면에서 조정 가능) ----------------
    const ASSUME_DEF = [
        ['E', '가격 탄력성', 2.0, 0.5, 4, 0.1, '가격 1% 인상 시 판매 몇 % 감소'],
        ['ad', '광고비 효과', 0.10, 0, 0.4, 0.01, '광고비 2배 → 판매 2^값 배'],
        ['store', '매장 수 효과', 0.30, 0, 0.8, 0.05, '매장 수 비율의 지수'],
        ['promo', '판촉비 효과', 0.05, 0, 0.4, 0.01, '매장당 판촉비 비율의 지수'],
        ['staff', '영업직원 효과', 0.40, 0, 1, 0.05, '활동 영업직원 수 비율의 지수'],
        ['model', '모델 1단계 상승 효과', 0.10, 0, 0.4, 0.01, '판매 모델 +1 → 판매 +값'],
        ['crm', 'CRM 도입 효과', 0.02, 0, 0.1, 0.01, '도입 시 판매 +값'],
        ['attrition', '영업직원 자연퇴직률', 0.13, 0, 0.3, 0.01, '1분기 실측 13%'],
        ['idleLabor', '조업중지 라인 노무비', 0.5, 0, 1, 0.1, '가동 라인 노무비 대비 비율'],
        ['liqPrice', '청산 단가(원)', 280000, 100000, 400000, 10000, '구모델 재고 개당 청산 가격 (1분기 실측 28만)']
    ];
    const assume = Object.fromEntries(ASSUME_DEF.map(a => [a[0], a[2]]));

    // ---------------- 입력 양식 (biz-manager 의사결정 항목 순서) ----------------
    // [역할, 항목, 키, 범위(country|factory|single), 단위표시, step]
    const FORM = [
        ['CEO', '연구개발비', 'rnd', 'single', '원', 1e8],
        ['CEO', 'CSR 활동비', 'csr', 'single', '원', 1e8],
        ['CEO', '임직원 인센티브', 'incentive', 'single', '원', 1e8],
        ['CEO', 'R&D 신기술 도입', 'newTech', 'single', '원', 1e9],
        ['CMO', '판매 제품 모델', 'model', 'single', '번', 1],
        ['CMO', '공장 발주량', 'order', 'country', '개', 1000],
        ['CMO', '판매 가격', 'price', 'country', 'cur', 1],
        ['CMO', '유통매장 신설(+)·폐쇄(−)', 'storeDelta', 'country', '개', 1],
        ['CMO', '광고비', 'ad', 'country', 'cur', 1],
        ['CMO', '판매촉진비(매장당)', 'promo', 'country', 'cur', 1],
        ['CMO', 'CRM 도입 (20억)', 'crm', 'single', '원', 2e9],
        ['COO', '가동 생산라인', 'lines', 'factory', '개', 1],
        ['COO', '조업중지 라인', 'idle', 'factory', '개', 1],
        ['COO', '작업시간 (40·44·48)', 'hours', 'factory', '시간', 4],
        ['COO', '부품 구매량', 'parts', 'factory', '개', 1000],
        ['COO', '설비관리 보전비(라인당)', 'maint', 'factory', 'cur', 1],
        ['COO', '품질개선비(한국 공장)', 'quality', 'single', '원', 1e8],
        ['COO', 'SCM 도입 (20억)', 'scm', 'single', '원', 2e9],
        ['CHO', '영업직원 채용(+)·해고(−)', 'hire', 'country', '명', 1],
        ['CHO', '영업직원 기본급(인당)', 'base', 'country', 'cur', 1],
        ['CHO', '영업직원 복리후생비(인당)', 'welfare', 'country', 'cur', 1],
        ['CHO', '생산직원 기본급(라인당)', 'prodBase', 'factory', 'cur', 1],
        ['CHO', '생산직원 복리후생비(라인당)', 'prodWelfare', 'factory', 'cur', 1],
        ['CHO', '영업직원 교육훈련비(본부별)', 'trainSales', 'country', 'cur', 1],
        ['CHO', '생산직원 교육훈련비(라인당)', 'trainProd', 'factory', 'cur', 1],
        ['CHO', '조직문화 혁신 (20억)', 'culture', 'single', '원', 2e9],
        ['CFO', '은행대출', 'loan', 'single', '원', 1e9]
    ];

    const HR_1Q = { hire: { KR: 0, US: 0, CN: 0 }, base: { KR: 2500000, US: 4000, CN: 9000 }, welfare: { KR: 300000, US: 400, CN: 2000 },
        prodBase: { KR: 1.8e9, CN: 6700000 }, prodWelfare: { KR: 2e8, CN: 750000 }, trainSales: { KR: 150e6, US: 50000, CN: 375000 }, trainProd: { KR: 80e6, CN: 150000 }, culture: 0 };
    const PRESETS = {
        draft: { name: '현재 입력값 (2분기 초안)', note: 'biz-manager 연도별 의사결정 탭에 저장된 5차년도 2분기 값. CHO·CFO는 아직 미입력이라 1분기 값으로 채움', v: {
            rnd: 450000, csr: 8e8, incentive: 2e9, newTech: 15e9, model: 5,
            order: { KR: 100000, US: 50000, CN: 100000 }, price: { KR: 1050000, US: 850, CN: 6380 }, storeDelta: { KR: -14, US: 0, CN: -12 },
            ad: { KR: 1.5e9, US: 1e6, CN: 16e6 }, promo: { KR: 50e6, US: 20000, CN: 400000 }, crm: 2e9,
            lines: { KR: 8, CN: 1 }, idle: { KR: 0, CN: 7 }, hours: { KR: 48, CN: 48 }, parts: { KR: 100000, CN: 10000 },
            maint: { KR: 45.5e6, CN: 119000 }, quality: 2.34e9, scm: 2e9, ...HR_1Q, loan: 0 } },
        keep1Q: { name: '1분기 결정 그대로', note: '5차년도 1분기에 실제로 낸 결정을 그대로 반복한 경우', v: {
            rnd: 9.6e9, csr: 4e8, incentive: 2e9, newTech: 0, model: 5,
            order: { KR: 100000, US: 50000, CN: 100000 }, price: { KR: 999900, US: 799, CN: 5800 }, storeDelta: { KR: 0, US: 0, CN: 0 },
            ad: { KR: 4e9, US: 1e6, CN: 2e7 }, promo: { KR: 140e6, US: 20000, CN: 800000 }, crm: 0,
            lines: { KR: 8, CN: 8 }, idle: { KR: 0, CN: 0 }, hours: { KR: 48, CN: 48 }, parts: { KR: 150000, CN: 100000 },
            maint: { KR: 45.5e6, CN: 119000 }, quality: 2.34e9, scm: 0, ...HR_1Q, loan: 0 } },
        suggest: { name: 'B팀 제안 예시', note: '재고를 먼저 줄이는 예시: 한국 2라인만 가동(미국 공급 포함), 중국 생산 중단, 가격 유지, 부품은 생산량만큼, 영업직원 기본급 일부 회복, 신기술·CRM·SCM 보류', v: {
            rnd: 9.6e9, csr: 4e8, incentive: 1e9, newTech: 0, model: 5,
            order: { KR: 25000, US: 15000, CN: 1 }, price: { KR: 999900, US: 799, CN: 5800 }, storeDelta: { KR: 0, US: 0, CN: 0 },
            ad: { KR: 4e9, US: 1e6, CN: 2e7 }, promo: { KR: 140e6, US: 20000, CN: 800000 }, crm: 0,
            lines: { KR: 2, CN: 1 }, idle: { KR: 6, CN: 7 }, hours: { KR: 40, CN: 40 }, parts: { KR: 38700, CN: 13937 },
            maint: { KR: 45.5e6, CN: 119000 }, quality: 2.34e9, scm: 0,
            ...HR_1Q, base: { KR: 3000000, US: 4500, CN: 10500 }, welfare: { KR: 400000, US: 500, CN: 2250 }, loan: 0 } }
    };
    // 중국 가동 라인은 최소 1개(유효 1~8)라 제안안도 1라인 40시간 — 부품은 그 생산량만큼 사서 긴급구매를 피함

    let dec = JSON.parse(JSON.stringify(PRESETS.draft.v)), activePreset = 'draft';
    const clone = o => JSON.parse(JSON.stringify(o));

    // ===================================================================
    // 엔진
    // ===================================================================
    function simulate(d, A) {
        const fx = SIM.fx, b = SIM.base, bg = SIM.begin, warn = [];
        const stores = {}, active = {}, hired = {}, attr = {};
        for (const c of C) {
            stores[c] = Math.max(1, bg.stores[c] + (d.storeDelta[c] || 0));
            attr[c] = Math.round(bg.staff[c] * A.attrition);
            const fired = Math.max(0, -(d.hire[c] || 0));
            active[c] = Math.max(0, bg.staff[c] - attr[c] - fired);
            hired[c] = Math.max(0, d.hire[c] || 0);
        }
        // 수요
        const pw = (x, y, e) => Math.pow(Math.max(x, 1e-9) / y, e);
        const demand = {};
        for (const c of C) {
            demand[c] = b.sales[c] * SIM.gdp[c]
                * pw(d.price[c], b.price[c], -A.E)
                * pw(d.ad[c], b.ad[c], A.ad)
                * pw(stores[c], b.stores[c], A.store)
                * pw(d.promo[c], b.promo[c], A.promo)
                * pw(active[c], b.active[c], A.staff)
                * Math.pow(1 + A.model, (d.model || 5) - b.model)
                * (d.crm > 0 ? 1 + A.crm : 1);
        }
        // 생산·입고 (한국 공장이 미국 발주분을 먼저 채우고 나머지는 한국으로, 중국 공장은 중국으로 — 1·4분기 실적 규칙)
        const prod = { KR: d.lines.KR * SIM.lineRate.KR * d.hours.KR / 48, CN: d.lines.CN * SIM.lineRate.CN * d.hours.CN / 48 };
        const inflow = { US: Math.min(d.order.US || 0, prod.KR) };
        inflow.KR = prod.KR - inflow.US; inflow.CN = prod.CN;
        if ((d.order.US || 0) > prod.KR) warn.push(['bad', `미국 발주 ${fmtN(d.order.US)}개를 한국 생산(${fmtN(prod.KR)}개)으로 다 채우지 못해요`]);
        // 모델 변경 → 구모델 재고 청산
        const changed = (d.model || 5) !== b.model;
        const liqUnits = changed ? C.reduce((s, c) => s + bg.inv[c], 0) : 0;
        if (changed) warn.push(['bad', `판매 모델을 ${b.model} → ${d.model}로 바꾸면 기존 재고 ${fmtN(liqUnits)}개가 개당 ${fmtN(A.liqPrice)}원에 청산돼요`]);
        const avail = {}, sold = {}, end = {};
        for (const c of C) {
            avail[c] = (changed ? 0 : bg.inv[c]) + inflow[c];
            sold[c] = Math.min(demand[c], avail[c]);
            end[c] = avail[c] - sold[c];
            if (demand[c] > avail[c] * 1.001) warn.push(['warn', `${CN_NAME[c]}: 수요 ${fmtN(demand[c])}개 > 판매가능 ${fmtN(avail[c])}개 — 품절로 판매 기회 손실`]);
        }
        const S = o => C.reduce((s, c) => s + o[c], 0);
        const revNormal = C.reduce((s, c) => s + sold[c] * d.price[c] * fx[c], 0);
        const revLiq = liqUnits * A.liqPrice;
        const rev = revNormal + revLiq;

        // 제조원가
        const mfg = {}, urgent = {};
        for (const f of ['KR', 'CN']) {
            const unitMat = f === 'KR' ? SIM.material.KR[d.model || 5] : SIM.material.CN[d.model || 5] * fx.CN;
            urgent[f] = Math.max(0, prod[f] - (d.parts[f] || 0));
            const material = (prod[f] - urgent[f]) * unitMat + urgent[f] * unitMat * SIM.urgentPremium[f];
            const perLineLabor = ((d.prodBase[f] || 0) + (d.prodWelfare[f] || 0)) * fx[f] * 1.1;
            const labor = d.lines[f] * perLineLabor + (d.idle[f] || 0) * perLineLabor * A.idleLabor;
            const overhead = SIM.fixedOverhead[f] + d.lines[f] * (SIM.utilityPerLine[f] * d.hours[f] / 48 + (d.maint[f] || 0) * fx[f] + (d.trainProd[f] || 0) * fx[f])
                + (f === 'KR' ? d.quality || 0 : 0);
            mfg[f] = material + labor + overhead;
            if (urgent[f] > 0) warn.push(['warn', `${CN_NAME[f]} 공장: 부품이 ${fmtN(urgent[f])}개 모자라 정상가의 ${SIM.urgentPremium[f]}배로 긴급구매 (+${fmtEok(urgent[f] * unitMat * (SIM.urgentPremium[f] - 1))})`]);
        }
        const mfgTotal = mfg.KR + mfg.CN, prodTotal = prod.KR + prod.CN;
        const soldTotal = S(sold), endTotal = S(end), beginUnits = S(bg.inv);
        let cogs, endVal;
        if (changed) {
            const avg = prodTotal ? mfgTotal / prodTotal : 0;
            cogs = bg.invValue + soldTotal * avg; endVal = endTotal * avg;
        } else {
            const avg = (bg.invValue + mfgTotal) / Math.max(1, beginUnits + prodTotal);
            cogs = soldTotal * avg; endVal = endTotal * avg;
        }

        // 판매관리비 (1분기 보고서로 맞춘 공식)
        const sga = {
            '임직원 급여(본사)': SIM.fixedSGA.hq,
            '영업직원 급여': C.reduce((s, c) => s + (active[c] + hired[c]) * ((d.base[c] || 0) + (d.welfare[c] || 0)) * fx[c], 0),
            '임직원 인센티브': d.incentive || 0,
            '광고비': C.reduce((s, c) => s + (d.ad[c] || 0) * fx[c], 0),
            '판매 촉진비': C.reduce((s, c) => s + stores[c] * (d.promo[c] || 0) * fx[c], 0),
            '물류비': inflow.KR * SIM.logistics.KR + inflow.US * SIM.logistics.US + inflow.CN * SIM.logistics.CN,
            '재고 관리비': endTotal * SIM.invCostPerUnit,
            '영업본부 유지비': SIM.fixedSGA.office,
            '유통매장 유지비': S(stores) * SIM.storeUpkeep,
            '교육훈련비': C.reduce((s, c) => s + (d.trainSales[c] || 0) * fx[c], 0),
            '연구개발비': (d.rnd || 0) + (d.newTech || 0),
            '본사 임차료': SIM.fixedSGA.rent,
            '혁신 추진비': (d.crm || 0) + (d.scm || 0) + (d.culture || 0),
            '기타비용': SIM.fixedSGA.other + (d.csr || 0)
        };
        const sgaTotal = Object.values(sga).reduce((a, x) => a + x, 0);
        const gp = rev - cogs, op = gp - sgaTotal;
        const interest = SIM.begin.bond * SIM.bondRateQ;
        const pretax = op - interest, tax = pretax > 0 ? pretax * 0.2 : 0, ni = pretax - tax;

        // 현금흐름
        const collect = 0.6;
        const cashIn = bg.ar + rev * collect;
        const cashOut = mfgTotal + sgaTotal - SIM.depreciation + interest + tax;
        const ocf = cashIn - cashOut;
        const fin = -bg.shortDebt + (d.loan || 0);
        let cash = ocf + fin, emergency = 0;
        if (cash < 0) { emergency = -cash; cash = 0; }
        if (emergency > 0) warn.push(['bad', `현금이 ${fmtEok(emergency)} 모자라 긴급자금대출(금리 21.4%)이 발생해요`]);
        if ((d.rnd || 0) > 0 && d.rnd < 1e8) warn.push(['warn', `연구개발비가 ${fmtN(d.rnd)}원이에요 — 단위를 확인하세요 (1분기 96억)`]);
        if (endTotal > soldTotal * 0.5) warn.push(['warn', `기말재고 ${fmtN(endTotal)}개 = 판매량의 ${(endTotal / Math.max(1, soldTotal)).toFixed(2)}배 (재고관리비 ${fmtEok(endTotal * SIM.invCostPerUnit)})`]);
        for (const c of C) if (d.price[c] > b.price[c] * 1.1 + 1e-6 || d.price[c] < b.price[c] * 0.9 - 1e-6) warn.push(['warn', `${CN_NAME[c]} 가격이 전기 대비 ±10% 허용 범위를 벗어나요`]);

        // 재무상태 (비율 계산용)
        const ar = rev * (1 - collect), nca = bg.nonCurrent - SIM.depreciation;
        const ca = cash + ar + bg.securities + endVal;
        const fs = {
            '매출액': rev, '청산 매출액': revLiq, '매출원가': cogs, '당분기 제조원가': mfgTotal, '매출총이익': gp,
            '판매및관리비': sgaTotal, '광고비': sga['광고비'], '판매촉진비': sga['판매 촉진비'], '재고관리비': sga['재고 관리비'],
            '연구개발비': sga['연구개발비'], '영업이익': op, '이자비용': interest, '당기순이익': ni,
            '영업활동 현금흐름': ocf, '투자활동 현금흐름': 0, '재무활동 현금흐름': fin, '현금의 증감': ocf + fin, '긴급자금대출': emergency, '기말 현금': cash,
            '유동자산': ca, '당좌자산': cash + ar + bg.securities, '현금 및 현금등가물': cash, '매출채권': ar, '단기매매증권': bg.securities,
            '재고자산': endVal, '비유동자산': nca, '자산총계': ca + nca,
            '유동부채': emergency + (d.loan || 0), '비유동부채': bg.bond, '부채총계': emergency + (d.loan || 0) + bg.bond, '자본총계': bg.equity + ni
        };
        return { demand, prod, inflow, avail, sold, end, stores, active, attr, urgent, rev, revNormal, revLiq, mfg, mfgTotal, cogs, sga, sgaTotal,
                 gp, op, interest, tax, ni, ocf, fin, cash, emergency, soldTotal, endTotal, fs, warn };
    }

    // ===================================================================
    // 화면
    // ===================================================================
    const fmtN = v => Math.round(v).toLocaleString('ko-KR');
    const unitOf = (u, c) => u === 'cur' ? CUR[c] : u;
    const getV = (key, c) => c ? (dec[key] || {})[c] : dec[key];
    const field = (key, c, step, unit) => {
        const v = getV(key, c);
        return `<label class="sim-in"><input type="number" step="${step}" data-sim="${key}${c ? '.' + c : ''}" value="${v ?? ''}" aria-label="${esc(key + (c ? ' ' + CN_NAME[c] : ''))}"><em>${esc(unit)}</em></label>`;
    };
    const krHint = v => Math.abs(v) >= 1e8 ? fmtEok(v) : '';

    function renderForm() {
        const host = document.getElementById('simForm');
        if (!host) return;
        let html = `<table class="sim-table"><thead><tr><th>역할</th><th>항목</th><th>한국</th><th>미국</th><th>중국</th></tr></thead><tbody>`;
        let lastRole = '';
        for (const [role, label, key, scope, unit, step] of FORM) {
            html += `<tr${role !== lastRole ? ' class="sim-role-start"' : ''}><td class="sim-role">${role !== lastRole ? role : ''}</td><td class="sim-label">${esc(label)}</td>`;
            lastRole = role;
            if (scope === 'single') html += `<td colspan="3">${field(key, null, step, unit)}<span class="sim-hint" data-hint="${key}">${krHint(getV(key))}</span></td>`;
            else for (const c of C) html += `<td>${scope === 'factory' && c === 'US' ? '<span class="sim-na">공장 없음</span>' : field(key, c, step, unitOf(unit, c))}</td>`;
            html += '</tr>';
        }
        host.innerHTML = html + '</tbody></table>';
        document.getElementById('simPresets').innerHTML = Object.entries(PRESETS).map(([k, p]) =>
            `<button class="sim-chip${k === activePreset ? ' is-active' : ''}" data-preset="${k}">${esc(p.name)}</button>`).join('');
        document.getElementById('simPresetNote').textContent = activePreset ? PRESETS[activePreset].note : '직접 바꾼 값으로 계산 중';
        document.getElementById('simAssume').innerHTML = ASSUME_DEF.map(([k, name, , min, max, step, hint]) => `
            <label class="sim-assume" title="${esc(hint)}"><span>${esc(name)}</span>
                <input type="range" min="${min}" max="${max}" step="${step}" value="${assume[k]}" data-assume="${k}">
                <b data-assume-v="${k}">${k === 'liqPrice' ? fmtN(assume[k]) : assume[k]}</b></label>`).join('');
    }

    function renderResult() {
        const host = document.getElementById('simResult');
        if (!host) return;
        const r = simulate(dec, assume), a = SIM.actual1Q;
        const tile = (label, v, base, unit, betterUp = true) => {
            const diff = v - base, tone = Math.abs(diff) < 1 ? 'neutral' : ((diff > 0) === betterUp ? 'good' : 'bad');
            const fmtV = unit === '원' ? fmtEok(v) : fmtN(v) + unit;
            const fmtD = unit === '원' ? fmtEok(Math.abs(diff)) : fmtN(Math.abs(diff)) + unit;
            return `<div class="sim-tile"><span class="sim-tile__label">${label}</span><b class="sim-tile__value${v < 0 ? ' fin-flag--bad' : ''}">${fmtV}</b>
                <span class="delta delta--${tone}">${diff > 0 ? '+' : diff < 0 ? '−' : ''}${fmtD}</span></div>`;
        };
        const cashTile = r.emergency > 0
            ? `<div class="sim-tile sim-tile--bad"><span class="sim-tile__label">긴급자금 필요</span><b class="sim-tile__value fin-flag--bad">${fmtEok(r.emergency)}</b><span class="sim-tile__sub">기말 현금 0원 · 금리 21.4%</span></div>`
            : `<div class="sim-tile sim-tile--good"><span class="sim-tile__label">기말 현금</span><b class="sim-tile__value fin-flag--good">${fmtEok(r.cash)}</b><span class="sim-tile__sub">긴급자금 없음</span></div>`;
        const rows = C.map(c => `<tr><td>${CN_NAME[c]}</td><td class="cell-num">${fmtN(r.demand[c])}</td><td class="cell-num">${fmtN(r.avail[c])}</td>
            <td class="cell-num"><b>${fmtN(r.sold[c])}</b></td><td class="cell-num${r.end[c] > r.sold[c] * 0.5 ? ' fin-flag--bad' : ''}">${fmtN(r.end[c])}</td>
            <td class="cell-num">${fmtEok(r.sold[c] * dec.price[c] * SIM.fx[c])}</td></tr>`).join('');
        const keyRatios = ['매출총이익률', '영업이익률', '순이익률', '판관비율', 'ROE (자기자본이익률)', '부채비율', '유동비율', '재고자산회전율', '매출액증가율', '정상매출증가율', '영업현금흐름 마진', '이자보상배율'];
        const prevFs = FIN.data['5차년도 1분기'] || null;
        const ratios = keyRatios.map(n => RATIO_SPEC.find(s => s.name === n)).filter(Boolean).map(sp => {
            const v = ratioValue(sp, r.fs, prevFs), pv = prevFs ? ratioValue(sp, prevFs, FIN.data['4차년도 4분기']) : null;
            const fl = ratioFlag(sp, v), dl = ratioDelta(sp, v, pv);
            return `<div class="calc-res" title="${esc(sp.formula)}"><span class="calc-res__name">${esc(sp.name)}</span>
                <span class="calc-res__value${fl ? ' fin-flag--' + fl : ''}">${esc(fmtRatio(v, sp.unit))}</span>
                <span class="calc-res__sub">${dl ? `<span class="delta delta--${dl.tone}">${esc(dl.txt)}</span> vs 1분기` : ''}</span></div>`;
        }).join('');
        const sgaRows = Object.entries(r.sga).filter(([, v]) => v).sort((x, y) => y[1] - x[1])
            .map(([k, v]) => `<div class="sim-bar"><span>${esc(k)}</span><i style="width:${Math.min(100, v / r.sgaTotal * 100 * 2.2)}%"></i><b>${fmtEok(v)}</b></div>`).join('');
        host.innerHTML = `
            <div class="sim-tiles">
                ${tile('판매량', r.soldTotal, a.판매량, '개')}
                ${tile('매출액', r.rev, a.매출액, '원')}
                ${tile('영업이익', r.op, a.영업이익, '원')}
                ${tile('당기순이익', r.ni, a.당기순이익, '원')}
                ${tile('기말재고', r.endTotal, a.기말재고, '개', false)}
                ${cashTile}
            </div>
            <p class="sim-caption">초록·빨강 배지 = 5차년도 1분기 실제 대비 · 매출 ${fmtEok(r.rev)} 중 청산 매출 ${fmtEok(r.revLiq)}</p>
            ${r.warn.length ? `<ul class="sim-warn">${r.warn.map(([t, m]) => `<li class="sim-warn--${t}"><i class="fa-solid ${t === 'bad' ? 'fa-circle-exclamation' : 'fa-triangle-exclamation'}"></i>${esc(m)}</li>`).join('')}</ul>` : '<p class="sim-ok"><i class="fa-solid fa-circle-check"></i> 눈에 띄는 경고가 없어요</p>'}
            <div class="table-wrap"><table class="data-table sim-country">
                <thead><tr><th>국가</th><th class="num">추정 수요</th><th class="num">판매가능</th><th class="num">판매</th><th class="num">기말재고</th><th class="num">매출</th></tr></thead>
                <tbody>${rows}</tbody></table></div>
            <div class="sim-pl">
                <div><span>매출액</span><b>${fmtEok(r.rev)}</b></div><div><span>매출원가</span><b>${fmtEok(r.cogs)}</b></div>
                <div><span>매출총이익</span><b>${fmtEok(r.gp)}</b></div><div><span>판매관리비</span><b>${fmtEok(r.sgaTotal)}</b></div>
                <div><span>영업이익</span><b class="${r.op < 0 ? 'fin-flag--bad' : 'fin-flag--good'}">${fmtEok(r.op)}</b></div><div><span>당기순이익</span><b class="${r.ni < 0 ? 'fin-flag--bad' : 'fin-flag--good'}">${fmtEok(r.ni)}</b></div>
                <div><span>당분기 제조원가</span><b>${fmtEok(r.mfgTotal)}</b></div><div><span>생산량</span><b>${fmtN(r.prod.KR + r.prod.CN)}개</b></div>
                <div><span>영업활동 현금흐름</span><b class="${r.ocf < 0 ? 'fin-flag--bad' : ''}">${fmtEok(r.ocf)}</b></div><div><span>긴급자금 상환</span><b>${fmtEok(SIM.begin.shortDebt)}</b></div>
            </div>
            <details class="sim-details"><summary>판매관리비 내역 (${fmtEok(r.sgaTotal)})</summary><div class="sim-bars">${sgaRows}</div></details>
            <div class="sim-sub">예상 재무비율 <small>· 1분기 실제 대비</small></div>
            <div class="calc-results__grid">${ratios}</div>`;
        document.querySelectorAll('[data-hint]').forEach(el => el.textContent = krHint(getV(el.dataset.hint)));
    }

    // ---------------- 이벤트 ----------------
    document.addEventListener('input', e => {
        const t = e.target;
        if (t.dataset.sim) {
            const [k, c] = t.dataset.sim.split('.');
            const v = parseFloat(t.value);
            if (c) dec[k][c] = isNaN(v) ? 0 : v; else dec[k] = isNaN(v) ? 0 : v;
            if (activePreset) { activePreset = null; document.querySelectorAll('.sim-chip').forEach(b => b.classList.remove('is-active')); document.getElementById('simPresetNote').textContent = '직접 바꾼 값으로 계산 중'; }
            renderResult();
        } else if (t.dataset.assume) {
            assume[t.dataset.assume] = parseFloat(t.value);
            const out = document.querySelector(`[data-assume-v="${t.dataset.assume}"]`);
            if (out) out.textContent = t.dataset.assume === 'liqPrice' ? fmtN(assume.liqPrice) : t.value;
            renderResult();
        }
    });
    document.addEventListener('click', e => {
        const b = e.target.closest('[data-preset]');
        if (b && b.closest('#simPresets')) { activePreset = b.dataset.preset; dec = clone(PRESETS[activePreset].v); renderForm(); renderResult(); }
        if (e.target.closest('#simResetAssume')) { ASSUME_DEF.forEach(a => assume[a[0]] = a[2]); renderForm(); renderResult(); }
    });

    window.renderSimulator = () => { renderForm(); renderResult(); };
    window.__sim = { simulate, SIM, PRESETS, assume };
})();
