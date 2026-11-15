import bpy, math
from mathutils import Vector

# NASA Perseverance-inspired Mars rover scene generator
# Run in Blender's Scripting workspace. The script saves Perseverance_Rover.blend
# beside this script (or to the output path configured below).

OUTPUT_PATH = bpy.path.abspath("//Perseverance_Rover.blend")
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.materials, bpy.data.curves, bpy.data.meshes, bpy.data.cameras, bpy.data.lights):
    pass

def mat(name, color, metallic=0.0, rough=0.45, emission=None):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*color, 1)
    bs.inputs["Metallic"].default_value = metallic
    bs.inputs["Roughness"].default_value = rough
    if emission:
        bs.inputs["Emission Color"].default_value = (*color, 1)
        bs.inputs["Emission Strength"].default_value = emission
    return m

white = mat("Warm aerospace ceramic", (0.72,0.70,0.62), .28, .32)
ivory = mat("Instrument ivory", (0.88,0.84,0.72), .18, .3)
dark = mat("Graphite titanium", (0.055,0.067,0.075), .72, .3)
rubber = mat("Wheel carbon rubber", (0.025,0.032,0.036), .05, .82)
gold = mat("Thermal blanket gold", (0.62,0.34,0.075), .72, .28)
gold_light = mat("Foil highlights", (0.9,0.61,0.18), .78, .22)
silver = mat("Brushed aluminum", (0.48,0.54,0.58), .82, .25)
black = mat("Optical glass", (0.008,0.025,0.045), .45, .12)
blue = mat("Instrument blue", (0.025,0.19,0.32), .55, .26)
red = mat("Mars regolith", (0.32,0.105,0.045), .05, .95)
red2 = mat("Darker Martian soil", (0.19,0.055,0.025), .0, 1)
white_text = mat("Marking white", (0.95,0.91,0.78), .1, .4)

def assign(obj, material):
    if material: obj.data.materials.append(material)
    return obj

def bevel(obj, amount=0.06, segments=3):
    mod = obj.modifiers.new("Precision edge radii", "BEVEL")
    mod.width = amount
    mod.segments = segments
    obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    return obj

def cube(name, loc, scale, material, bevel_amt=0.04, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o=bpy.context.object; o.name=name; o.dimensions=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rot: o.rotation_euler=rot
    assign(o,material)
    if bevel_amt: bevel(o,bevel_amt)
    return o

def cyl(name, loc, radius, depth, material, axis='Z', vertices=48, bevel_amt=0.025):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    o=bpy.context.object; o.name=name
    if axis=='Y': o.rotation_euler[0]=math.pi/2
    elif axis=='X': o.rotation_euler[1]=math.pi/2
    assign(o,material)
    if bevel_amt: bevel(o,bevel_amt,2)
    return o

def uv(name, loc, scale, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(o,material)
    return o

def beam(name, a, b, radius, material, vertices=24):
    a,b=Vector(a),Vector(b); d=b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=d.length, location=(a+b)/2)
    o=bpy.context.object; o.name=name; o.rotation_mode='QUATERNION'
    o.rotation_quaternion=d.to_track_quat('Z','Y')
    assign(o,material); bevel(o, min(radius*.25,.025),2)
    return o

def torus(name, loc, major, minor, material, rot=(math.pi/2,0,0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=64, minor_segments=12, location=loc, rotation=rot)
    o=bpy.context.object; o.name=name; assign(o,material)
    return o

def text_obj(body, loc, size, material, rot=(math.pi/2,0,0)):
    cu=bpy.data.curves.new("Engraved lettering", 'FONT'); cu.body=body; cu.size=size
    cu.extrude=.0015; cu.bevel_depth=.0008
    ob=bpy.data.objects.new(body,cu); bpy.context.collection.objects.link(ob)
    ob.location=loc; ob.rotation_euler=rot; assign(ob,material)
    return ob

# Main chassis: long central warm-white aerospace body
cube("Central rover chassis", (0,0,1.72), (3.25,2.05,.78), white, .16)
cube("Lower dark chassis keel", (0,0,1.28), (2.8,1.72,.22), dark, .08)
cube("Upper equipment deck", (-.08,0,2.17), (2.75,1.78,.18), ivory, .07)
# layered thermal blanket / instrument bay panels
for side in [-1,1]:
    cube("Gold thermal blanket side panel", (0,side*1.045,1.76), (2.55,.045,.48), gold, .025)
    for x in [-1.05,-.55,-.05,.45,.95]:
        cube("Foil panel seam", (x,side*1.073,1.76), (.018,.012,.43), gold_light, .003)
    for x in [-1.25,1.25]:
        cube("Chassis corner armor", (x,side*1.04,1.75), (.22,.10,.58), silver, .035)
# deck boxes, vents, latches
for x in [-.9,-.45,0,.45,.9]:
    cube("Deck ventilation grille", (x,-.48,2.28), (.27,.32,.035), dark, .015)
    for j in range(5):
        cube("Vent slat", (x-.10+j*.05,-.48,2.305), (.018,.25,.012), silver, .004)
for x in [-1.25,1.25]:
    for y in [-.72,.72]:
        cyl("Deck fastener", (x,y,2.285), .045,.025,silver,vertices=24)

# Six wheels and rocker-bogie assemblies
wheel_x=[-1.85,0,1.85]
wheel_y=[-1.43,1.43]
wheel_z=.72
for side in [-1,1]:
    # longitudinal rocker arm, and two bogie links
    beam("Rocker suspension arm", (-1.35,side*1.10,1.18), (1.35,side*1.10,1.18), .105, silver)
    beam("Front bogie link", (0.95,side*1.10,1.16), (1.85,side*1.36,.75), .085, dark)
    beam("Rear bogie link", (-.95,side*1.10,1.16), (-1.85,side*1.36,.75), .085, dark)
    beam("Suspension center strut", (0,side*1.10,1.18), (0,side*1.36,.73), .075, silver)
    for x in wheel_x:
        y=side*1.48
        # axle and wheel body, cylinder axis along Y
        cyl("Wheel hub inner", (x,y-side*.12,wheel_z), .48,.23,dark,'Y')
        cyl("Six-wheel rugged tire", (x,y,wheel_z), .49,.30,rubber,'Y',64,.035)
        cyl("Outer hub silver ring", (x,y+side*.165,wheel_z), .31,.035,silver,'Y')
        cyl("Hub dark inset", (x,y+side*.19,wheel_z), .235,.04,dark,'Y')
        cyl("Hub center cap", (x,y+side*.22,wheel_z), .105,.05,gold_light,'Y')
        torus("Raised wheel rim", (x,y+side*.205,wheel_z), .37,.025,silver)
        # 24 raised angled grousers around tire circumference
        for k in range(24):
            ang=2*math.pi*k/24
            xx=x+math.cos(ang)*.475
            zz=wheel_z+math.sin(ang)*.475
            tread=cube("Chevron wheel grouser", (xx,y,zz), (.19,.34,.105), rubber, .018,
                       rot=(0, -ang, side*.10))
        # small hub bolts
        for k in range(8):
            ang=2*math.pi*k/8
            bx=x+math.cos(ang)*.27; bz=wheel_z+math.sin(ang)*.27
            cyl("Wheel hub bolt", (bx,y+side*.225,bz), .022,.025,gold_light,'Y',16,.004)

# Front bumper and navigation hazard markers
cube("Front instrument bumper", (1.68,0,1.65), (.18,1.75,.28), dark, .05)
for y in [-.72,.72]:
    cube("Front amber marker", (1.79,y,1.66), (.025,.13,.09), gold_light, .015)

# Mast pedestal and vertical mast
cyl("Remote sensing mast base", (-.55,0,2.42), .28,.20,dark)
cyl("Mast rotation collar", (-.55,0,2.57), .19,.12,silver)
beam("Camera mast column", (-.55,0,2.62), (-.55,0,3.65), .075, silver)
for z in [2.85,3.25,3.55]:
    torus("Mast collar ring", (-.55,0,z), .085,.018,gold,rot=(0,0,0))
# Mast head crossbar and camera pods
cube("Mast camera head", (-.55,0,3.72), (.88,.34,.30), ivory, .08)
for xoff in [-.30,.30]:
    cyl("Mast camera lens bezel", (-.55+xoff,-.19,3.75), .115,.10,dark,'Y')
    cyl("Mast camera optical glass", (-.55+xoff,-.25,3.75), .075,.025,black,'Y')
    torus("Mast lens silver ring", (-.55+xoff,-.27,3.75), .09,.012,silver)
# Mast top laser/science sensor
cube("Mast top sensor", (-.55,.02,3.94), (.28,.24,.12), blue, .035)
uv("Sensor status lamp", (-.55,-.12,3.96), (.035,.018,.035), gold_light)

# Robotic arm mounted at front right, articulated segments
arm_base=(1.05,-.68,1.95); elbow=(1.62,-.92,1.48); wrist=(2.05,-1.02,1.70); tool=(2.30,-1.04,1.53)
cyl("Robotic arm shoulder turret", arm_base,.22,.20,dark)
uv("Shoulder joint",arm_base,(.18,.18,.18),silver)
beam("Robotic arm upper link",arm_base,elbow,.105,white)
uv("Elbow joint",elbow,(.14,.14,.14),gold_light)
beam("Robotic arm forearm",elbow,wrist,.085,silver)
uv("Wrist rotary joint",wrist,(.12,.12,.12),dark)
beam("Arm tool extension",wrist,tool,.055,white)
# turret-like drill and scoop at end
cyl("Sampling drill housing", tool,.10,.25,dark,'Z')
beam("Drill bit", (tool[0],tool[1],tool[2]-.10),(tool[0],tool[1],tool[2]-.34),.035,silver)
for z in [tool[2]-.16,tool[2]-.23,tool[2]-.30]:
    beam("Drill helical ridge", (tool[0]-.045,tool[1],z),(tool[0]+.045,tool[1],z-.025),.012,gold_light,12)
# arm cable
beam("Arm cable run", (1.18,-.82,1.9),(1.72,-.99,1.58),.018,dark,12)

# High-gain antenna dish on rear deck
cyl("Antenna pedestal",(-1.05,.55,2.38),.13,.22,dark)
beam("Antenna stalk",(-1.05,.55,2.45),(-1.20,.72,2.95),.035,silver)
# shallow dish as UV sphere segment impression + rim
uv("High gain antenna dish",(-1.22,.73,3.02),(.38,.12,.38),silver)
uv("Antenna dish dark face",(-1.22,.61,3.02),(.31,.035,.31),dark)
beam("Antenna feed arm",(-1.22,.60,3.02),(-1.22,.36,3.13),.025,gold_light)
uv("Antenna feed horn",(-1.22,.34,3.14),(.07,.07,.07),ivory)
# UHF antenna
beam("UHF antenna mast",(-1.15,-.55,2.35),(-1.30,-.55,3.22),.018,silver)
uv("UHF antenna tip",(-1.30,-.55,3.24),(.035,.035,.035),gold_light)

# Science instrument boxes and small details
cube("Rear radioisotope power housing",(-1.05,0,2.48),(.72,.78,.26),white,.06)
for y in [-.25,0,.25]:
    cube("Power unit cooling fin",(-1.05,y,2.66),(.55,.035,.16),silver,.012)
cube("Sample caching assembly",(.35,.48,2.48),(.70,.56,.28),ivory,.055)
cube("Instrument blue panel",(.35,.48,2.635),(.42,.32,.025),blue,.018)
for x in [.18,.35,.52]:
    cyl("Instrument indicator", (x,.30,2.65),.025,.02,gold_light,vertices=16)
# small sensor housings
for x,y in [(-1.18,-.72),(-1.18,.72),(1.25,-.72),(1.25,.72)]:
    cube("Corner sensor pod",(x,y,2.35),(.24,.20,.16),dark,.035)
    uv("Sensor lens",(x,y-.105,2.36),(.045,.025,.045),black)

# Rover branding plate
cube("Mission identification plaque",(.0,-1.085,1.78),(1.15,.025,.30),dark,.025)
text_obj("MARS 2020",(-.48,-1.105,1.82),.105,white_text)
text_obj("PERSEVERANCE",( -.48,-1.106,1.69),.075,gold_light)
# small NASA-inspired round insignia on top deck
cyl("Mission insignia base",(.88,.62,2.30),.18,.035,blue)
torus("Insignia silver border",(.88,.62,2.325),.145,.012,silver,rot=(0,0,0))

# Martian terrain base with irregular rock formations
cube("Martian terrain display base",(0,0,-.10),(8.5,7.0,.20),red,.10)
for i in range(32):
    # deterministic scattered rocks around, avoiding the rover's immediate footprint
    ang=i*2.399
    rad=2.4+(i%5)*.42
    x=math.cos(ang)*rad; y=math.sin(ang)*rad
    if abs(x)<1.9 and abs(y)<1.8: continue
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=(x,y,.03))
    rock=bpy.context.object; rock.name="Weathered Martian rock"
    rock.scale=(.12+(i%3)*.06,.10+(i%4)*.04,.07+(i%2)*.05)
    assign(rock, red2)
# surface pebbles
for i in range(70):
    x=((i*37)%79)/10-3.9; y=((i*19)%63)/10-3.1
    if abs(x)<1.9 and abs(y)<1.7: continue
    uv("Martian gravel",(x,y,.015),(.025,.035,.014),red2)

# Lighting, camera and studio-like Mars scene
world=bpy.context.scene.world
world.color=(0.12,0.12,0.12)
world.use_nodes=True
world.node_tree.nodes["Background"].inputs[0].default_value=(0.22,0.16,0.12,1)
world.node_tree.nodes["Background"].inputs[1].default_value=.35

def area_light(name, loc, energy, size, color):
    bpy.ops.object.light_add(type='AREA', location=loc)
    l=bpy.context.object; l.name=name; l.data.energy=energy; l.data.shape='DISK'; l.data.size=size; l.data.color=color
    l.rotation_euler=(Vector((0,0,1.0))-l.location).to_track_quat('-Z','Y').to_euler()
    return l
area_light("Warm Martian sun key",(2,-5,8),1700,5,(1.0,.78,.57))
area_light("Cool sky fill",(-5,-1,5),1000,4,(.62,.74,1.0))
area_light("Rear rim light",(1,5,6),1900,3,(1.0,.55,.32))

bpy.ops.object.camera_add(location=(7,-10,6.2))
cam=bpy.context.object; cam.name="Hero rover camera"
target=Vector((0,0,1.55))
cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.lens=52
bpy.context.scene.camera=cam

scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE_NEXT'
scene.eevee.taa_render_samples=64
scene.render.resolution_x=1600
scene.render.resolution_y=1200
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath="//Perseverance_Rover_Render.png"
scene.view_settings.view_transform='AgX'
scene.render.film_transparent=False

# Organize scene into named collections
# (objects remain in scene; collections make the Outliner easier to navigate)
for name in ["ROVER | Chassis and instruments","ROVER | Mobility system","ROVER | Mast and science arm","ENVIRONMENT | Mars surface","STUDIO | Lighting and camera"]:
    if not bpy.data.collections.get(name):
        col=bpy.data.collections.new(name); scene.collection.children.link(col)

# Set viewport to camera view and select chassis
bpy.ops.object.select_all(action='DESELECT')
ch=bpy.data.objects.get("Central rover chassis")
if ch:
    ch.select_set(True); bpy.context.view_layer.objects.active=ch
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_perspective='CAMERA'

# Save native Blender project
bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_PATH)
print("Saved Blender project:", OUTPUT_PATH)