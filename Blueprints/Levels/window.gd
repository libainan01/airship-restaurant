extends Window

@onready var window = $Window
@onready var style_modifier = WindowAPI.new()

func _ready() -> void:
	await  get_tree().process_frame
	#style_modifier.Setwindowstyle(self,0)
