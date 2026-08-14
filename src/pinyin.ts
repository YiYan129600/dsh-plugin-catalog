/**
 * dsh-plugin-catalog — pinyin syllable table + converter (plan §5.8 / D10,
 * v0.2.0 task 2).
 *
 * Hand-written static pinyin syllable table: ZERO new dependencies, no
 * dictionary package, no network. It covers the common characters that
 * appear across this project's own corpus — every Chinese character used in
 * the built-in alias table (`src/search.ts`) and the built-in Chinese table
 * (`src/localize.ts`) plus a base set of everyday characters — so that a
 * latin-pinyin query like 「yuan cheng」 resolves to 远程 and 「kan ban」 to
 * 看板 through the search layer (see `src/search.ts` L2.5).
 *
 * Pure, dependency-free module shared by BOTH halves (and the vitest suite),
 * exactly like `src/search.ts` and `src/localize.ts`. It performs no I/O and
 * touches no DOM.
 *
 * Reverse-validation contract: `pinyinForText` reads the table through the
 * `table` parameter defaulting to `PINYIN_SYLLABLE_TABLE`; when the table is
 * emptied the converter emits no syllables, so the 「yuan cheng」/「kan ban」
 * search cases must go red.
 */

/**
 * Character → pinyin syllable (no tone marks, lowercase, spaces join words
 * later). Multi-pronunciation characters keep their primary reading; the
 * matching layer only needs an overlapping syllable, so this is sufficient
 * for fuzzy search.
 */
export const PINYIN_SYLLABLE_TABLE: Record<string, string> = {
  // ── everyday base characters ──
  一: 'yi', 是: 'shi', 了: 'le', 在: 'zai', 我: 'wo', 他: 'ta', 这: 'zhe',
  个: 'ge', 们: 'men', 来: 'lai', 到: 'dao', 说: 'shuo', 要: 'yao', 就: 'jiu',
  你: 'ni', 着: 'zhe', 那: 'na', 得: 'de', 也: 'ye', 为: 'wei', 没: 'mei',
  很: 'hen', 走: 'zou', 样: 'yang', 少: 'shao', 打: 'da', 叫: 'jiao',
  让: 'rang', 比: 'bi', 最: 'zui', 高: 'gao', 老: 'lao', 短: 'duan',
  慢: 'man', 早: 'zao', 晚: 'wan', 今: 'jin', 小: 'xiao', 大: 'da',
  // ── an / ba / bai / ban … ──
  安: 'an', 按: 'an', 暗: 'an', 白: 'bai', 摆: 'bai', 板: 'ban', 版: 'ban',
  办: 'ban', 半: 'ban', 包: 'bao', 报: 'bao', 备: 'bei', 本: 'ben',
  // ── bi / bian / biao / bing / bu ──
  边: 'bian', 编: 'bian', 变: 'bian', 标: 'biao', 表: 'biao', 并: 'bing',
  补: 'bu', 布: 'bu', 部: 'bu', 不: 'bu',
  // ── cai / cao / ce / ceng / cha / chan / chang / chao / chi / chong ──
  裁: 'cai', 菜: 'cai', 操: 'cao', 槽: 'cao', 册: 'ce', 侧: 'ce', 测: 'ce',
  策: 'ce', 层: 'ceng', 叉: 'cha', 插: 'cha', 查: 'cha', 察: 'cha',
  产: 'chan', 常: 'chang', 超: 'chao', 持: 'chi', 宠: 'chong',
  // ── chou / chu / chuan / chuang / ci / cun / cheng ──
  抽: 'chou', 出: 'chu', 础: 'chu', 储: 'chu', 触: 'chu', 穿: 'chuan',
  传: 'chuan', 窗: 'chuang', 创: 'chuang', 词: 'ci', 次: 'ci', 存: 'cun',
  成: 'cheng', 程: 'cheng',
  // ── da / dai / dan / dao / de / deng / di / dian / diao / ding / dong / du ──
  代: 'dai', 带: 'dai', 待: 'dai', 单: 'dan', 弹: 'dan', 导: 'dao', 道: 'dao',
  的: 'de', 等: 'deng', 地: 'di', 点: 'dian', 调: 'diao', 丁: 'ding', 定: 'ding',
  动: 'dong', 读: 'du', 度: 'du',
  // ── duan / dui / duo ──
  端: 'duan', 断: 'duan', 对: 'dui', 多: 'duo',
  // ── fa / fan / fang / fen / fu ──
  发: 'fa', 反: 'fan', 范: 'fan', 方: 'fang', 防: 'fang', 仿: 'fang',
  访: 'fang', 放: 'fang', 分: 'fen', 肤: 'fu', 服: 'fu', 浮: 'fu',
  附: 'fu', 复: 'fu',
  // ── gai / gang / ge / gei / gen / geng / gong / gu / gua / guan / gui / guo ──
  概: 'gai', 杠: 'gang', 格: 'ge', 给: 'gei', 跟: 'gen', 更: 'geng',
  工: 'gong', 功: 'gong', 供: 'gong', 共: 'gong', 贡: 'gong', 估: 'gu',
  骨: 'gu', 挂: 'gua', 关: 'guan', 观: 'guan', 管: 'guan', 规: 'gui',
  轨: 'gui', 果: 'guo',
  // ── han / hao / he / hen / hou / hu / hua / huan / hui ──
  汉: 'han', 好: 'hao', 耗: 'hao', 合: 'he', 核: 'he', 后: 'hou',
  候: 'hou', 互: 'hu', 户: 'hu', 划: 'hua', 画: 'hua', 话: 'hua', 化: 'hua',
  欢: 'huan', 环: 'huan', 缓: 'huan', 换: 'huan', 徽: 'hui', 回: 'hui',
  汇: 'hui', 会: 'hui', 绘: 'hui',
  // ── ji / jia / jian / jiao / jie / jin / jing / jiu / ju / jue ──
  击: 'ji', 机: 'ji', 基: 'ji', 级: 'ji', 集: 'ji', 辑: 'ji', 计: 'ji',
  记: 'ji', 技: 'ji', 迹: 'ji', 继: 'ji', 加: 'jia', 家: 'jia', 价: 'jia',
  架: 'jia', 间: 'jian', 监: 'jian', 剪: 'jian', 检: 'jian', 件: 'jian',
  建: 'jian', 键: 'jian', 交: 'jiao', 胶: 'jiao', 脚: 'jiao', 接: 'jie',
  节: 'jie', 结: 'jie', 解: 'jie', 界: 'jie', 进: 'jin', 鲸: 'jing',
  境: 'jing', 静: 'jing', 久: 'jiu', 局: 'ju', 具: 'ju', 据: 'ju',
  聚: 'ju', 决: 'jue',
  // ── ka / kai / kan / ke / kong / kou / ku / kuai / kuang / kui / kuo ──
  卡: 'ka', 开: 'kai', 看: 'kan', 可: 'ke', 客: 'ke', 空: 'kong', 控: 'kong',
  口: 'kou', 库: 'ku', 酷: 'ku', 块: 'kuai', 快: 'kuai', 框: 'kuang', 馈: 'kui',
  扩: 'kuo',
  // ── lan / lei / li / lian / liang / liao / lie / ling / liu / lu / lve / lun ──
  栏: 'lan', 览: 'lan', 类: 'lei', 理: 'li', 力: 'li', 连: 'lian', 联: 'lian',
  量: 'liang', 聊: 'liao', 列: 'lie', 令: 'ling', 浏: 'liu', 流: 'liu',
  录: 'lu', 路: 'lu', 略: 'lve', 轮: 'lun',
  // ── ma / mei / men / mian / ming / mo / mu ──
  码: 'ma', 每: 'mei', 美: 'mei', 面: 'mian', 名: 'ming', 明: 'ming',
  命: 'ming', 模: 'mo', 默: 'mo', 目: 'mu',
  // ── na / nei / neng / ni / niang ──
  内: 'nei', 能: 'neng', 娘: 'niang',
  // ── pai / pei / pi / pian / ping ──
  排: 'pai', 牌: 'pai', 派: 'pai', 配: 'pei', 批: 'pi', 皮: 'pi',
  偏: 'pian', 片: 'pian', 平: 'ping', 评: 'ping', 凭: 'ping',
  // ── qi / qian / qiang / qiao / qie / qing / qiu / qu / quan / qun ──
  期: 'qi', 其: 'qi', 启: 'qi', 起: 'qi', 契: 'qi', 器: 'qi', 前: 'qian',
  强: 'qiang', 桥: 'qiao', 切: 'qie', 清: 'qing', 擎: 'qing', 请: 'qing',
  求: 'qiu', 区: 'qu', 驱: 'qu', 取: 'qu', 全: 'quan', 权: 'quan',
  群: 'qun',
  // ── ran / re / ren / ri / ru ──
  染: 'ran', 热: 're', 人: 'ren', 认: 'ren', 任: 'ren', 日: 'ri', 入: 'ru',
  // ── san / sao / sha / shang / she / shen / sheng / shi / shou / shu ──
  三: 'san', 扫: 'sao', 沙: 'sha', 商: 'shang', 上: 'shang', 设: 'she',
  射: 'she', 深: 'shen', 审: 'shen', 升: 'sheng', 生: 'sheng', 时: 'shi',
  实: 'shi', 示: 'shi', 式: 'shi', 事: 'shi', 试: 'shi', 适: 'shi',
  手: 'shou', 守: 'shou', 首: 'shou', 受: 'shou', 枢: 'shu', 输: 'shu',
  属: 'shu', 署: 'shu', 树: 'shu', 数: 'shu',
  // ── shuang / shui / shuo / si / sou / su / suan / sui / suo ──
  双: 'shuang', 水: 'shui', 私: 'si', 搜: 'sou', 宿: 'su',
  溯: 'su', 算: 'suan', 随: 'sui', 隧: 'sui', 缩: 'suo', 索: 'suo',
  // ── tai / ti / tian / tiao / ting / tong / tou / tu / tui / tun / tuo ──
  台: 'tai', 态: 'tai', 提: 'ti', 题: 'ti', 体: 'ti', 替: 'ti', 天: 'tian',
  条: 'tiao', 停: 'ting', 通: 'tong', 统: 'tong', 桶: 'tong', 头: 'tou',
  投: 'tou', 图: 'tu', 吐: 'tu', 退: 'tui', 吞: 'tun', 托: 'tuo',
  拖: 'tuo',
  // ── wai / wang / wei / wen / wu ──
  外: 'wai', 网: 'wang', 围: 'wei', 维: 'wei', 尾: 'wei', 委: 'wei',
  卫: 'wei', 文: 'wen', 问: 'wen', 无: 'wu', 务: 'wu', 物: 'wu',
  // ── xi / xia / xian / xiang / xiao / xie / xin / xing / xu / xuan / xun ──
  析: 'xi', 息: 'xi', 系: 'xi', 下: 'xia', 现: 'xian', 线: 'xian',
  限: 'xian', 献: 'xian', 箱: 'xiang', 向: 'xiang', 象: 'xiang',
  消: 'xiao', 校: 'xiao', 斜: 'xie', 写: 'xie', 炫: 'xuan', 心: 'xin', 新: 'xin',
  行: 'xing', 型: 'xing', 醒: 'xing', 续: 'xu', 悬: 'xuan', 选: 'xuan',
  渲: 'xuan', 询: 'xun', 循: 'xun',
  // ── ya / yan / yao / ye / yi / yin / ying / yong / you / yu / yuan / yue / yun ──
  压: 'ya', 言: 'yan', 验: 'yan', 遥: 'yao', 页: 'ye', 义: 'yi',
  溢: 'yi', 引: 'yin', 应: 'ying', 英: 'ying', 迎: 'ying', 影: 'ying',
  用: 'yong', 由: 'you', 有: 'you', 右: 'you', 于: 'yu', 鱼: 'yu',
  与: 'yu', 语: 'yu', 预: 'yu', 域: 'yu', 源: 'yuan', 远: 'yuan',
  约: 'yue', 运: 'yun',
  // ── zai / zan / ze / zeng / zhan / zhang / zhao / zhe / zhi / zhong ──
  载: 'zai', 赞: 'zan', 择: 'ze', 增: 'zeng', 展: 'zhan', 章: 'zhang',
  长: 'chang', 账: 'zhang', 照: 'zhao', 者: 'zhe', 支: 'zhi', 执: 'zhi',
  止: 'zhi', 只: 'zhi', 指: 'zhi', 志: 'zhi', 制: 'zhi', 智: 'zhi',
  置: 'zhi', 中: 'zhong', 终: 'zhong', 重: 'zhong',
  // ── zhou / zhu / zhua / zhuai / zhuan / zhuang / zhuo / zi / zu / zuo ──
  周: 'zhou', 轴: 'zhou', 逐: 'zhu', 主: 'zhu', 注: 'zhu', 抓: 'zhua',
  拽: 'zhuai', 转: 'zhuan', 装: 'zhuang', 状: 'zhuang', 桌: 'zhuo',
  资: 'zi', 子: 'zi', 自: 'zi', 族: 'zu', 组: 'zu', 作: 'zuo', 座: 'zuo',
}

/**
 * Convert Chinese text to space-separated pinyin syllables: 远程运维 →
 * `yuan cheng yun wei`. ASCII letter/digit runs pass through as lowercased
 * words (ssh → `ssh`), characters outside the table are dropped, and every
 * token is joined with single spaces. The `table` parameter defaults to the
 * static table so tests (and the reverse validation) can swap it for an
 * empty map — with an empty table no syllables are emitted, so a pinyin
 * query cannot match.
 */
export function pinyinForText(text: string, table: Record<string, string> = PINYIN_SYLLABLE_TABLE): string {
  const parts: string[] = []
  let run = ''
  const flushRun = (): void => {
    if (run !== '') {
      parts.push(run)
      run = ''
    }
  }
  for (const char of text) {
    if (/[a-z0-9]/i.test(char)) {
      run += char.toLowerCase()
      continue
    }
    flushRun()
    const syllable = table[char]
    if (syllable !== undefined) parts.push(syllable)
    // CJK characters outside the table and any separators are dropped.
  }
  flushRun()
  return parts.join(' ')
}
