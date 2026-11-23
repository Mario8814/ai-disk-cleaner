# 生成 AI 磁盘管家的应用图标 build/icon.ico（含多尺寸）以及 preview.png 供预览
from PIL import Image, ImageDraw, ImageFont
import math

S = 256

# 1) 渐变背景
img = Image.new('RGB', (S, S))
px = img.load()
c1 = (76, 141, 255)   # 顶部
c2 = (91, 107, 255)   # 底部
for y in range(S):
    t = y / (S - 1)
    r = int(c1[0] + (c2[0] - c1[0]) * t)
    g = int(c1[1] + (c2[1] - c1[1]) * t)
    b = int(c1[2] + (c2[2] - c1[2]) * t)
    for x in range(S):
        px[x, y] = (r, g, b)

# 2) 圆角矩形透明蒙版（圆角 52）
mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=52, fill=255)

rgba = Image.new('RGBA', (S, S), (0, 0, 0, 0))
rgba.paste(img, (0, 0), mask)

d = ImageDraw.Draw(rgba)

# 3) 顶部 "AI" 字样（凸显 AI 特色）
try:
    font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 62)
except Exception:
    font = ImageFont.load_default()
d.text((128, 56), "AI", font=font, fill=(255, 255, 255, 255), anchor="mm")

# 4) 白色硬盘外壳（下移给 AI 字样腾出空间）
d.rounded_rectangle([48, 100, 208, 180], radius=20, fill=(255, 255, 255, 255))

# 5) 盘片 + 主轴孔
d.ellipse([88 - 30, 140 - 30, 88 + 30, 140 + 30], fill=(207, 224, 255, 255))
d.ellipse([88 - 7, 140 - 7, 88 + 7, 140 + 7], fill=(42, 77, 204, 255))

# 6) 读写臂
d.line([88, 140, 132, 108], fill=(91, 107, 255, 255), width=7)
d.ellipse([128, 102, 140, 114], fill=(91, 107, 255, 255))

# 7) 螺丝（四角）
for cx, cy in [(68, 120), (68, 160), (188, 120), (188, 160)]:
    d.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=(213, 219, 230, 255))

# 8) 状态灯（绿色）
d.ellipse([184 - 5, 132 - 5, 184 + 5, 132 + 5], fill=(47, 198, 123, 255))

# 9) 右下角「已清理」绿色对勾徽章
d.ellipse([180 - 22, 168 - 22, 180 + 22, 168 + 22], fill=(47, 198, 123, 255))
d.line([172, 168, 179, 175, 190, 160], fill=(255, 255, 255, 255), width=6, joint='curve')

# 输出多尺寸 ico 和预览图
rgba.save('build/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
rgba.save('build/preview.png')
print('icon generated: build/icon.ico')
