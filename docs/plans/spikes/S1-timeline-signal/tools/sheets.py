# usage: python3 -I sheets.py <shots dir> <out dir>   (Pillow)
# Contact sheets of the S1 crops: one row per candidate and level, pill crop and strip crop side by side (portrait) or stacked (landscape).
import sys
from PIL import Image, ImageDraw, ImageFont
SH=sys.argv[1] if len(sys.argv)>1 else './s1-out/shots'
OUT=sys.argv[2] if len(sys.argv)>2 else './s1-out/sheets'
import os; os.makedirs(OUT,exist_ok=True)
F=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
FB=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',22)
rows=[('none','ok','Today (no signal)'),('t1','behind','T1 button, behind'),('t1','waiting','T1 button, waiting'),('t2','behind','T2 badge, behind'),('t2','waiting','T2 badge, waiting'),('t3','behind','T3 thumb ring, behind'),('t3','waiting','T3 thumb ring, waiting')]
def sheet(vp,look,scale):
    bg={'light':(236,238,242),'light-hc':(236,238,242),'dark':(24,26,30),'dark-hc':(24,26,30)}[look]
    fg=(20,24,32) if look.startswith('light') else (235,238,242)
    ims=[]
    for v,l,label in rows:
        a=Image.open(f'{SH}/{vp}-{look}-{v}-{l}-pill.png').convert('RGB')
        b=Image.open(f'{SH}/{vp}-{look}-{v}-{l}-strip.png').convert('RGB')
        ims.append((label,a,b))
    pad=14; lh=34
    if vp=='portrait':
        w=ims[0][1].width+ims[0][2].width+pad*3
        rowh=[max(a.height,b.height)+lh+pad for _,a,b in ims]
    else:
        w=max(a.width for _,a,_ in ims)+pad*2
        rowh=[a.height+b.height+lh+pad*2 for _,a,b in ims]
    H=sum(rowh)+pad
    img=Image.new('RGB',(w,H),bg); d=ImageDraw.Draw(img); y=pad
    for (label,a,b),rh in zip(ims,rowh):
        d.text((pad,y),f'{label}  [{vp} {look}]',font=FB,fill=fg); y2=y+lh
        if vp=='portrait':
            img.paste(a,(pad,y2)); img.paste(b,(pad*2+a.width,y2))
        else:
            img.paste(a,(pad,y2)); img.paste(b,(pad,y2+a.height+pad))
        y+=rh
    if scale!=1: img=img.resize((int(img.width*scale),int(img.height*scale)),Image.LANCZOS)
    p=f'{OUT}/S1-{vp}-{look}.jpg'; img.save(p,quality=82,optimize=True); print(p,img.size,os.path.getsize(p)//1024,'kB')
for look in ['light','dark','light-hc','dark-hc']:
    sheet('portrait',look,0.8)
    sheet('landscape',look,0.55)
