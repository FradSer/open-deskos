Feature: svc_llm 统一 LLM 服务与日配额(Open DeskOS-OS §6.2 约束 3/4)

  Scenario: 配额内请求完成并计数
    Given 日配额为 50 且今日已用 10 次
    When 调用 svc_llm_complete 且注入的 HTTP 端口返回合法补全
    Then 返回 assistant 文本与 token 用量
    And 今日计数变为 11
    And 剩余配额查询返回 39

  Scenario: 配额耗尽时请求被拒绝且不发起网络调用
    Given 日配额为 50 且今日已用 50 次
    When 调用 svc_llm_complete
    Then 返回配额耗尽错误
    And 注入的 HTTP 端口未被调用

  Scenario: 跨日配额自动重置
    Given 日配额为 50 且 20260710 已用 50 次
    When 注入时钟拨到 20260711 后调用 svc_llm_complete
    Then 请求正常发出
    And 今日计数从 1 重新累计

  Scenario: token 用量被累计并可查询(成本可见)
    Given 今日已完成 2 次请求,用量分别为 100+200 与 50+80 tokens
    When 查询 svc_llm_total_tokens_today
    Then 返回 430
    And 每次 complete 的 usage 出参与响应中的用量一致

  Scenario: 传输失败返回可恢复错误且配额计数不增加
    Given 今日已用 10 次
    When 注入的 HTTP 端口返回传输错误
    Then svc_llm_complete 返回 HTTP 错误枚举
    And 今日计数仍为 10
