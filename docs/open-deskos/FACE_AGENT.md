# Open DeskOS FaceID & Emotion Agent

面向 Open DeskOS (CM5 / RK3588S) 的轻量级端侧视觉智能子系统，提供 **FaceID 人脸解锁**、**面部 5 关键点姿态追踪**、**8 维情绪分类** 与 **专注/疲劳状态感知**。

---

## 1. 硬件光学模组与多摄解析 (Robot 3D SLAM / Multi-Camera Architecture)

模组采用 **Novatek (联咏) 边缘视觉 SoC + 主动双目红外 (Active Stereo) + RGB 多摄融合架构**（VID:PID `3482:6723`，产品标识 `ASJ ZNX_NVT`）。

```
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ 1. 左目 IR   │   │ 2. 散斑投射器 │   │ 3. RGB 彩色  │   │ 4. 右目 IR   │
  │ (红外特征追踪)│   │ (不可见点阵) │   │ (彩色/人脸)   │   │ (立体视差测距)│
  └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
  └──────────────────────── 基线距离 (Baseline) ────────────────────────┘
```

### 1.1 各光学镜头与器件分工

1. **左/右对称镜头：双目红外相机 (Stereo IR Cameras)**
   * **外观特征**：位于模组最左与最右两侧，具有固定基线（Baseline），带红外窄带滤光片（镀膜偏深红/暗黑）。
   * **数据流**：`1280x1040` (左右目未压缩裸流) / `640x642` (带 IMU 纳秒级同步元数据)。
   * **作用**：通过左右目微小视差计算空间 3D 深度图；在机器人移动时持续追踪空间特征点，驱动 **VIO (视觉惯性里程计)** 推算空间位移与姿态。
2. **中间高清镜头：RGB 彩色相机 (RGB Camera)**
   * **外观特征**：通透度较高的彩色镀膜镜头。
   * **数据流**：`1280x720` @ 30fps (MJPEG 高清流)。
   * **作用**：提供高清人脸纹理用于 **FaceID 解锁** 与 **FERPlus 情绪识别**；为机器人 3D 点云提供彩色贴图，并在 SLAM 中提供回环检测 (Loop Closure)。
3. **平头/毛玻璃窗口：主动红外激光散斑投射器 (IR Dot Projector / VCSEL)**
   * **外观特征**：平整光栅窗口，肉眼不可见或仅有微弱暗红点。
   * **作用**：在面对白墙、光滑地板或无光黑暗环境时，主动向空间发射数万个不可见散斑点阵，人工制造表面纹理，让双目相机在任何极端光照下都能稳定测距（主动立体视觉）。

### 1.2 为什么能做机器人 3D 空间定位与导航（跑路线）

```
[左目 IR + 右目 IR] ──► 双目立体匹配 ──► 输出空间深度图 (Depth Map) ──► 避开前方障碍物
         │
         ▼
[嵌入元数据 (642行)] ─► 提取纳秒级时间戳 + 6轴 IMU 惯导数据 ──► VIO 里程计 (计算移动距离与转角)
         │
         ▼
[RGB 彩色相机] ─────► 关键帧回环检测 (Loop Closure) ──► 消除累积误差，生成全局 3D 地图
```

* **嵌入式元数据 (Metadata Embedding)**：`640x642` 分辨率多出的 2 行像素包含板载 6 轴 IMU 与曝光时间戳，确保图像与惯导数据硬件级 0 延迟同步，避免机器人高速移动时漂移。
* **边缘芯片分担算力**：模组内部 Novatek 芯片硬件完成双目去畸变、立体校正与散斑匹配，不挤占 CM5 主脑 CPU/GPU 资源。
* **3D 活体防伪 (True FaceID)**：借助红外双目与深度信息，从物理层面直接拦截平面照片、手机屏幕翻拍欺骗。

---

## 2. 核心算法与模型选型

| 模块 | 模型 / 算法 | 规格 / 算力需求 | 功能描述 |
| :--- | :--- | :--- | :--- |
| **人脸检测与关键点** | **YuNet (ONNX)** | 232 KB (ONNX) | 超轻量人脸定位 (~22ms)，输出人脸边界框与 5 核心关键点（左眼、右眼、鼻尖、左嘴角、右嘴角）、置信度与 Roll/Yaw 姿态角 |
| **FaceID 特征识别** | **SFace (ONNX)** | 38.6 MB (ONNX) | 深度特征提取 (~15ms)，提取 128 维特征向量，采用余弦相似度（阈值 >= 0.363）进行 1:1 / 1:N 主人身份比对与解锁 |
| **情绪感知** | **FERPlus (ONNX)** | 35 MB (ONNX) | 8 维情绪概率分布输出（平静/专注、开心/微笑、惊讶、低落/疲惫、烦躁/紧绷、厌恶、警觉、轻蔑） |
| **状态/专注度评估** | **几何姿态启发式** | 纯 CPU 计算 | 结合头部倾斜度 (Roll)、偏航 (Yaw) 与表情置信度，综合给出「专注中」、「视线偏离」、「愉悦放松」、「疑似疲惫」等状态 |

---

## 3. 目录结构

```
/opt/face-agent/
├── data/
│   └── owner_profile.json      # 已录入的主人人脸特征数据库
├── models/
│   ├── emotion-ferplus-8.onnx  # 情绪识别模型
│   ├── face_detection_yunet_2023mar.onnx   # 人脸检测与关键点模型
│   └── face_recognition_sface_2021dec.onnx # SFace 特征提取模型
├── face_engine.py              # 核心计算库 (FaceAgentEngine)
├── face_cli.py                 # 命令行管理与测试工具
├── face_service.py             # HTTP REST & SSE 实时推流微服务 (端口 8790)
├── test_demo.py                # 单元测试与基准性能测试脚本
└── README.md                   # 本说明文档
```

运行环境使用专属虚拟环境：`/opt/face-agent-venv/`。

---

## 4. 性能指标 (CM5 / aarch64 实测)

* **单帧人脸检测**：`22.5 ms`
* **情绪识别推理**：`33.2 ms`
* **SFace 特征提取与比对**：`15.0 ms`
* **端到端单帧总耗时**：`~70.0 ms` (等效 **14~20 FPS**，无卡顿实时响应)

---

## 5. CLI 命令行使用说明

系统已注册全局命令 `face-agent`。

### 5.1 查看已录入的主人列表
```bash
face-agent list
```

### 5.2 录入主人 FaceID 特征

对于连接 ESP32-P4 的 Open DeskOS，主人录入只能在 P4 本机完成：确保画面中恰好有一张有效人脸，然后按下 P4 的 **BOOT/GPIO 0** 物理确认键。P4 在 30 秒确认窗口内将人脸特征保存为本地配置的主人；CM5 HTTP 接口和串口命令不能触发录入。

`face-agent enroll` 仅适用于独立的本地视频设备工作流，不适用于 P4 设备。

```bash
face-agent enroll --name "Frad" --device /dev/video0
```

### 5.3 测试识别与分析
```bash
# 单张图片测试（输出分析结果并生成标注图片至 /tmp/face_result.jpg）
face-agent test --file /path/to/test.jpg --output /tmp/face_result.jpg

# 实时摄像头流模式（终端持续输出 FaceID 解锁状态、情绪与耗时）
face-agent test --device /dev/video0
```

---

## 6. 后台微服务 (HTTP & SSE API)

启动服务：
```bash
/opt/face-agent-venv/bin/python3 /opt/face-agent/face_service.py
```
服务仅在 `http://127.0.0.1:8790` 监听；它不对网络暴露人脸状态或 enrollment 接口。

### API 接口清单

| 端点 | 方法 | 说明 | 返回内容 |
| :--- | :--- | :--- | :--- |
| `/status` | `GET` | 查询服务状态与主人列表 | JSON |
| `/enroll` | `POST` | P4 模式下拒绝录入请求（必须按 P4 BOOT/GPIO 0）；本地视频设备模式录入当前画面中的主人人脸 | JSON |
| `/events` | `GET` | **SSE 实时事件流** (供 Open DeskOS 订阅) | `text/event-stream` |
| `/snapshot.jpg` | `GET` | 获取带 FaceID 标注框与情绪标签的最新 JPEG 快照 | `image/jpeg` |

#### SSE 事件载荷示例 (`/events`)
```json
{
  "faces_count": 1,
  "any_unlocked": true,
  "processing_time_ms": 69.3,
  "faces": [
    {
      "box": [217, 112, 204, 247],
      "detect_score": 0.76,
      "landmarks": {
        "right_eye": [285.1, 196.4],
        "left_eye": [366.0, 202.6],
        "nose_tip": [321.9, 249.0],
        "right_mouth": [282.1, 279.9],
        "left_mouth": [355.2, 284.3]
      },
      "pose": {
        "roll_deg": 4.4,
        "yaw_ratio": -0.05,
        "facing_forward": true
      },
      "face_id": {
        "unlocked": true,
        "user": "Frad",
        "similarity": 0.884,
        "threshold": 0.363
      },
      "emotion": {
        "primary": "happiness",
        "primary_zh": "开心/微笑",
        "confidence": 0.91,
        "distribution": {
          "neutral": 0.05,
          "happiness": 0.91,
          "surprise": 0.02,
          "sadness": 0.01,
          "anger": 0.0,
          "disgust": 0.0,
          "fear": 0.0,
          "contempt": 0.01
        }
      },
      "user_state": "愉悦放松"
    }
  ]
}
```

---

## 7. Open DeskOS (Electron) 联动建议

1. 在 `firmware/linux/src/renderer/plugins/` 下添加 `status-faceid.js` 插件。
2. 通过 `new EventSource('http://127.0.0.1:8790/events')` 监听状态变化。
3. 当 `any_unlocked: true` 时在状态栏呈现绿色小锁解锁动画，并开放受保护的 App/磁贴交互。
4. 当 `emotion.primary == 'sadness'` 或 `user_state == '疑似疲惫/低落'` 持续超过设定阈值时，自动触发桌面关怀提醒或番茄钟休息提示。
