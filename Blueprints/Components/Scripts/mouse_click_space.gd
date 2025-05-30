extends Path2D




class_name MouseClickSpace

var _path_points:PackedVector2Array #异形窗口边框
var _dynamin_path_points:Dictionary
var _screen_size:Vector2i#当前屏幕分辨率

var _top_path_points:PackedVector2Array#顶部边框点
var _right_path_points:PackedVector2Array#左边边框点
var _bottom_path_points:PackedVector2Array#底部边框点
var _base_path_points:PackedVector2Array#初始点位

enum NodeDirection
{
	Top,
	Right,
	Bottom,
}

func _ready() -> void:
	_init_mouse_click_space()

func _init_mouse_click_space(minsize:float = 3)->void:
	_screen_size = DisplayServer.screen_get_size()#初始化屏幕大小！！！！！！！！！！！！！！！如果动态调整屏幕分辨率后导致异形窗口绘制出错，需要在这里修改
	#初始化异形窗口基础顶点
	var FirstPoint = Vector2i(0,0) as Vector2i                                  #左上角
	var SecondPoint = Vector2i(_screen_size.x,0) as Vector2i                    #右上角
	var ThirdPoint = _screen_size as Vector2i                                   #右下角
	var FourthPoint = Vector2i(0,_screen_size.y) as Vector2i                    #左下角
	var FifthPoint = Vector2i(FourthPoint.x,FourthPoint.y - minsize)            #左下角 2
	var SixthPoint = Vector2i(ThirdPoint.x-minsize,ThirdPoint.y-minsize)        #右下角 2
	var SeventhPoint = Vector2i(SecondPoint.x-minsize,SecondPoint.y+minsize)    #右上角 2
	var EightPoint = Vector2i(FirstPoint.x,FirstPoint.y+minsize)                #左上角 2
	#初始化顶点数组
	_bottom_path_points = [FifthPoint,SixthPoint]
	_right_path_points = [SixthPoint,SeventhPoint]
	_top_path_points = [SeventhPoint,EightPoint]
	_base_path_points = [FirstPoint,SecondPoint,ThirdPoint,FourthPoint,FifthPoint,SixthPoint,SeventhPoint,EightPoint]
	#初始化完毕，绘制异形窗口
	redraw_mouse_passthrough_polygon()

func add_mouse_click_space(target:Node2D,newpoints:PackedVector2Array,direction:NodeDirection)->void:
	_dynamin_path_points[target] = newpoints#存储对应对象的点位
	match direction:
		NodeDirection.Top:
			_top_path_points.append_array(newpoints)
			pass
		NodeDirection.Right:
			pass
		NodeDirection.Bottom:
			pass
		
	
func remove_mouse_click_space(target:Node2D)->void:
	var _remove_points = _dynamin_path_points.get(target) as PackedVector2Array
	if _remove_points == null : return
	for point in _remove_points:
		_path_points.remove_at(_path_points.rfind(point))

func _sort_the_path_points(direction:NodeDirection) ->void:
	match direction:
		NodeDirection.Top:
			
			pass
	pass

func _update_path_points () ->void: #！！！！！！！！！！！！！！！！！！！！！！！！！状态好的时候看看这里能不能做性能优化
	_path_points.append_array(_bottom_path_points)
	for i in range(1,_right_path_points.size()):
		_path_points.append(_right_path_points[i])
	for i in range(1,_top_path_points.size()):
		_path_points.append(_top_path_points[i])
	
func redraw_mouse_passthrough_polygon() ->void:
	#get_window().mouse_passthrough_polygon = _path_points
	get_window().mouse_passthrough = true
func clean_mouse_passthrough_polygon() -> void:
	get_window().mouse_passthrough_polygon = []

#func bubble_sort(arr:PackedVector2Array) -> PackedVector2Array:
#	var sorted_arr = arr.duplicate()
#	var n = sorted_arr.size()
	
