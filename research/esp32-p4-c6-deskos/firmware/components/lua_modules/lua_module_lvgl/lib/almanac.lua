-- almanac.lua -- 香港黃曆（萬年曆 + 通勝）計算庫
--
-- 提供：公曆↔農曆換算、干支、生肖、宜忌、節氣
-- 所有日期時間均基於 UTC（設備不涉時區，以整日計算）

local M = {}

-- ── 常數 ────────────────────────────────────────────────────────────────

local HEAVENLY_STEMS = { "甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸" }
local EARTHLY_BRANCHES = { "子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥" }
local ZODIAC = { "鼠", "牛", "虎", "兔", "龍", "蛇", "馬", "羊", "猴", "雞", "狗", "豬" }
local LUNAR_MONTHS = { "正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "臘月" }
local LUNAR_DAYS = {
    "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
}

-- 二十四節氣
local SOLAR_TERMS = {
    "小寒", "大寒", "立春", "雨水", "驚蟄", "春分",
    "清明", "穀雨", "立夏", "小滿", "芒種", "夏至",
    "小暑", "大暑", "立秋", "處暑", "白露", "秋分",
    "寒露", "霜降", "立冬", "小雪", "大雪", "冬至"
}

-- 節氣近似日（1 月～12 月，每月 2 個）
local SOLAR_TERM_DAYS = {
    {5, 20},  -- 小寒/大寒 (1月)
    {4, 19},  -- 立春/雨水 (2月)
    {6, 21},  -- 驚蟄/春分 (3月)
    {5, 20},  -- 清明/穀雨 (4月)
    {6, 21},  -- 立夏/小滿 (5月)
    {6, 21},  -- 芒種/夏至 (6月)
    {7, 23},  -- 小暑/大暑 (7月)
    {7, 23},  -- 立秋/處暑 (8月)
    {8, 23},  -- 白露/秋分 (9月)
    {8, 23},  -- 寒露/霜降 (10月)
    {7, 22},  -- 立冬/小雪 (11月)
    {7, 22},  -- 大雪/冬至 (12月)
}

-- ── 農曆數據表（2024-2043）──────────────────────────────────────────────
--
-- 每條 { 年, 閏月(0=無), { 1月~12月各月天數 }, 閏月天數(0=無) }
local LUNAR_DATA = {
    {2024, 2, {30,29,29,30,29,30,30,29,30,29,30,29}, 30},
    {2025, 6, {29,30,29,29,30,30,29,29,30,30,29,30}, 29},
    {2026, 0, {29,30,29,30,29,30,29,30,29,30,29,30}, 0},
    {2027, 5, {29,30,29,29,30,30,29,30,29,30,30,29}, 30},
    {2028, 3, {30,29,30,29,30,30,29,30,29,30,29,30}, 29},
    {2029, 7, {29,30,29,30,29,30,30,29,30,29,30,29}, 30},
    {2030, 0, {30,29,30,29,30,29,30,29,30,29,30,29}, 0},
    {2031, 2, {30,29,30,29,30,30,29,30,29,30,29,30}, 29},
    {2032, 7, {29,30,29,30,29,30,29,30,30,29,30,29}, 30},
    {2033, 11, {30,29,30,29,30,29,30,29,30,29,30,29}, 30},
    {2034, 0, {30,29,30,29,30,30,29,30,29,30,29,30}, 0},
    {2035, 4, {29,30,29,30,29,30,29,30,30,29,30,29}, 29},
    {2036, 6, {30,29,30,29,30,30,29,30,29,30,29,30}, 30},
    {2037, 0, {29,30,29,30,29,30,29,30,29,30,29,30}, 0},
    {2038, 3, {30,29,30,29,30,30,29,30,29,30,29,30}, 29},
    {2039, 6, {29,30,29,30,29,30,30,29,30,29,30,29}, 29},
    {2040, 0, {30,29,30,29,30,29,30,29,30,29,30,30}, 0},
    {2041, 2, {29,30,29,30,30,29,30,29,30,29,30,29}, 30},
    {2042, 5, {30,29,30,29,30,30,29,30,29,30,29,30}, 29},
    {2043, 0, {29,30,29,30,29,30,29,30,29,30,29,30}, 0},
}

-- 農曆新年（正月初一）的公曆日期：{年, 月, 日}
local LUNAR_NEW_YEAR = {
    {2024, 2, 10}, {2025, 1, 29}, {2026, 2, 17}, {2027, 2, 6},
    {2028, 1, 26}, {2029, 2, 13}, {2030, 2, 3}, {2031, 1, 23},
    {2032, 2, 11}, {2033, 1, 31}, {2034, 2, 19}, {2035, 2, 8},
    {2036, 1, 28}, {2037, 2, 15}, {2038, 2, 4}, {2039, 1, 24},
    {2040, 2, 12}, {2041, 2, 1}, {2042, 2, 21}, {2043, 2, 10},
}

-- 日干支基準：1900 年 1 月 1 日 = 庚戌（index 10，甲子=0）
local DAY_GANZHI_OFFSET = 10

-- 立春日（約 2 月 4 日）
local LICHUN_DAY = 4

-- ── 輔助函數 ───────────────────────────────────────────────────────────

local function is_leap_year(y)
    return (y % 4 == 0 and y % 100 ~= 0) or y % 400 == 0
end

local function gregorian_days(y, m)
    local DAYS = {31,28,31,30,31,30,31,31,30,31,30,31}
    local d = DAYS[m]
    if m == 2 and is_leap_year(y) then return 29 end
    return d
end

-- 公曆日期 → 絕對日數（從 1900-01-01 起算）
local function to_abs_days(y, m, d)
    local total = 0
    for yr = 1900, y - 1 do
        total = total + (is_leap_year(yr) and 366 or 365)
    end
    for mo = 1, m - 1 do
        total = total + gregorian_days(y, mo)
    end
    return total + d - 1
end

-- 尋找農曆年數據
local function find_lunar_year(gy, gm, gd)
    local abs_today = to_abs_days(gy, gm, gd)
    for offset = -1, 2 do
        local ry = gy + offset
        local entry = nil
        for _, e in ipairs(LUNAR_DATA) do
            if e[1] == ry then entry = e; break end
        end
        if not entry then goto continue end
        local ny = nil
        for _, ne in ipairs(LUNAR_NEW_YEAR) do
            if ne[1] == ry then ny = ne; break end
        end
        if not ny then goto continue end
        local abs_ny = to_abs_days(ny[1], ny[2], ny[3])
        -- 計算該農曆年總天數
        local total_days = 0
        local months = entry[3]
        for _, md in ipairs(months) do
            total_days = total_days + md
        end
        if entry[2] > 0 then
            total_days = total_days + entry[4]
        end
        local abs_ny_next = abs_ny + total_days
        -- 包含年末最後一天（除夕等邊界情況）
        if abs_today >= abs_ny and abs_today <= abs_ny_next then
            return entry, ny, abs_ny, abs_ny_next
        end
        ::continue::
    end
    -- 年末邊界 fallback：找最近的正月初一
    for _, ne in ipairs(LUNAR_NEW_YEAR) do
        local abs_ne = to_abs_days(ne[1], ne[2], ne[3])
        if abs_today >= abs_ne then
            local entry = nil
            for _, e in ipairs(LUNAR_DATA) do
                if e[1] == ne[1] then entry = e; break end
            end
            if entry then
                local total = 0
                for _, md in ipairs(entry[3]) do total = total + md end
                if entry[2] > 0 then total = total + entry[4] end
                if abs_today < abs_ne + total then
                    return entry, ne, abs_ne, abs_ne + total
                end
            end
        end
    end
    return nil
end

-- ── 公開 API ────────────────────────────────────────────────────────────

function M.is_leap_year(y)
    return is_leap_year(y)
end

-- 取得該日期的節氣（若有）
function M.get_solar_term(gy, gm, gd)
    local terms = SOLAR_TERM_DAYS[gm]
    if not terms then return nil end
    for idx, td in ipairs(terms) do
        if gd == td then
            return SOLAR_TERMS[(gm - 1) * 2 + idx]
        end
    end
    return nil
end

-- 公曆日期 → 農曆日期
function M.lunar_date(gy, gm, gd)
    local entry, ny, abs_ny = find_lunar_year(gy, gm, gd)
    if not entry then
        return nil
    end
    local abs_today = to_abs_days(gy, gm, gd)
    local offset = abs_today - abs_ny
    local months = entry[3]
    local leap_month = entry[2]
    local leap_days = entry[4] or 0
    local lm, ld, is_leap = 1, 1, false

    local accumulated = 0
    for mi, md in ipairs(months) do
        if offset < accumulated + md then
            lm = mi
            ld = offset - accumulated + 1
            is_leap = false
            break
        end
        accumulated = accumulated + md
        if leap_month > 0 and mi == leap_month then
            if offset < accumulated + leap_days then
                lm = mi
                ld = offset - accumulated + 1
                is_leap = true
                break
            end
            accumulated = accumulated + leap_days
        end
    end
    -- 如果是循環結束還沒找到，可能是最後一個月的殘餘
    if lm == 1 and ld == 1 and offset > 0 then
        for mi = 12, 1, -1 do
            local md = months[mi]
            if offset >= accumulated - md then
                lm = mi
                ld = offset - (accumulated - md) + 1
                break
            end
            accumulated = accumulated - md
        end
    end

    local year_stem, year_branch, year_ganzhi, zodiac = M.year_ganzhi(gy, gm, gd)
    local month_stem, month_branch, month_ganzhi = M.month_ganzhi(gy, gm, gd, year_stem)
    local day_stem, day_branch, day_ganzhi = M.day_ganzhi(gy, gm, gd)

    local month_name = (is_leap and "閏" or "") .. LUNAR_MONTHS[lm]
    local day_name = LUNAR_DAYS[ld] or tostring(ld)

    return {
        year = entry[1],
        month = lm,
        day = ld,
        leap = is_leap,
        leap_month = leap_month,
        month_name = month_name,
        day_name = day_name,
        year_stem = year_stem,
        year_branch = year_branch,
        year_ganzhi = year_ganzhi,
        month_stem = month_stem,
        month_branch = month_branch,
        month_ganzhi = month_ganzhi,
        day_stem = day_stem,
        day_branch = day_branch,
        day_ganzhi = day_ganzhi,
        zodiac = zodiac,
    }
end

-- 年干支（以立春為界）
function M.year_ganzhi(gy, gm, gd)
    local y = gy
    if gm < 2 or (gm == 2 and gd < LICHUN_DAY) then
        y = gy - 1
    end
    local stem = (y - 4) % 10 + 1
    local branch = (y - 4) % 12 + 1
    return stem, branch, HEAVENLY_STEMS[stem] .. EARTHLY_BRANCHES[branch], ZODIAC[branch]
end

-- 月干支
function M.month_ganzhi(gy, gm, gd, year_stem)
    -- 月地支：寅(3)=正月, 卯(4)=二月, ..., 丑(2)=十二月
    local branch = (gm + 2) % 12
    if branch == 0 then branch = 12 end
    -- 甲己之年丙作首，乙庚之歲戊為頭，丙辛之年庚為頭，丁壬之年壬為頭，戊癸之年甲為頭
    -- 年干 0=甲,1=乙,2=丙,3=丁,4=戊,5=己,6=庚,7=辛,8=壬,9=癸
    local stem_table = {3, 5, 7, 9, 1}  -- 丙戊庚壬甲
    local stem_start = stem_table[((year_stem - 1) % 5) + 1]
    local stem = (stem_start + gm - 1) % 10
    if stem == 0 then stem = 10 end
    return stem, branch, HEAVENLY_STEMS[stem] .. EARTHLY_BRANCHES[branch]
end

-- 日干支
function M.day_ganzhi(gy, gm, gd)
    local abs = to_abs_days(gy, gm, gd)
    local idx = (abs + DAY_GANZHI_OFFSET) % 60
    local stem = idx % 10 + 1
    local branch = idx % 12 + 1
    return stem, branch, HEAVENLY_STEMS[stem] .. EARTHLY_BRANCHES[branch]
end

-- 沖煞
local CHONG_MAP = { "馬", "羊", "猴", "雞", "狗", "豬", "鼠", "牛", "虎", "兔", "龍", "蛇" }
function M.chong(branch)
    return CHONG_MAP[branch]
end

-- 宜忌（簡化版：基於日地支）
local YI_JI = {
    {yi={"祭祀", "祈福", "求嗣", "沐浴"}, ji={"嫁娶", "出行", "開市", "安葬"}},
    {yi={"嫁娶", "出行", "開市", "交易", "納財"}, ji={"祭祀", "祈福", "解除"}},
    {yi={"祭祀", "祈福", "求嗣", "開市", "交易"}, ji={"嫁娶", "出行", "安床", "作灶"}},
    {yi={"嫁娶", "出行", "開市", "入宅", "安床"}, ji={"祭祀", "動土", "破土", "安葬"}},
    {yi={"祭祀", "祈福", "解除", "嫁娶", "出行"}, ji={"開市", "入宅", "作灶", "安葬"}},
    {yi={"出行", "開市", "交易", "納財", "嫁娶"}, ji={"祭祀", "祈福", "安床", "動土"}},
    {yi={"祭祀", "祈福", "求嗣", "解除", "沐浴"}, ji={"嫁娶", "出行", "開市", "安葬"}},
    {yi={"嫁娶", "出行", "入宅", "安床", "作灶"}, ji={"祭祀", "祈福", "開市", "動土"}},
    {yi={"祭祀", "祈福", "嫁娶", "出行", "開市"}, ji={"入宅", "安床", "作灶", "破土"}},
    {yi={"嫁娶", "出行", "開市", "交易", "納財"}, ji={"祭祀", "祈福", "解除", "安葬"}},
    {yi={"祭祀", "祈福", "求嗣", "解除", "沐浴"}, ji={"嫁娶", "出行", "開市", "安葬"}},
    {yi={"嫁娶", "出行", "開市", "入宅", "安床"}, ji={"祭祀", "祈福", "動土", "破土"}},
}

function M.yi_ji(branch)
    if not branch or branch < 1 or branch > 12 then
        return {yi={}, ji={}}
    end
    return YI_JI[branch]
end

-- 取得完整黃曆資訊
function M.almanac(gy, gm, gd)
    local lunar = M.lunar_date(gy, gm, gd)
    if not lunar then return nil end
    local term = M.get_solar_term(gy, gm, gd)
    local chong = M.chong(lunar.day_branch)
    local yj = M.yi_ji(lunar.day_branch)
    return {
        gregorian = { year = gy, month = gm, day = gd },
        lunar = lunar,
        solar_term = term,
        chong = "沖" .. chong,
        yi = yj.yi,
        ji = yj.ji,
    }
end

-- 取得今天的黃曆
function M.today()
    local now = os.time()
    local gy = tonumber(os.date("%Y", now))
    local gm = tonumber(os.date("%m", now))
    local gd = tonumber(os.date("%d", now))
    return M.almanac(gy, gm, gd)
end

-- 取得星期名稱
local WEEKDAY_NAMES = { "星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六" }
function M.weekday_name(gy, gm, gd)
    local t = os.time({year=gy, month=gm, day=gd})
    local wday = tonumber(os.date("%w", t))
    return WEEKDAY_NAMES[wday+1]
end

return M